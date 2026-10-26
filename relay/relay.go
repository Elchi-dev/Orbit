package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Limits and timings from docs/REMOTE.md.
const (
	maxMessage      = 1 << 20 // bytes per websocket message
	maxNotify       = 4 << 10 // bytes per notify body
	maxPhones       = 64      // connect pipes plus wait sockets per room
	maxEarly        = 16      // phone messages kept until the host accepts
	pipesPerMinute  = 16      // new pipes per minute per IP
	writeTimeout    = 15 * time.Second
	pingTimeout     = 15 * time.Second
	defaultPing     = 25 * time.Second
	defaultAccept   = 15 * time.Second
	statusNoHost    = websocket.StatusCode(4404)
	statusReplaced  = websocket.StatusCode(4409)
	statusGoingAway = websocket.StatusGoingAway
)

// Relay joins phones to the Orbit host of a room. It forwards frames as they
// come and never looks inside them.
type Relay struct {
	token      [32]byte // SHA-256 of the relay token
	trustProxy bool
	pingEvery  time.Duration
	acceptWait time.Duration
	log        *log.Logger
	limiter    *limiter

	mu    sync.Mutex
	rooms map[string]*room
}

type room struct {
	host    *websocket.Conn
	phones  int
	pending map[string]*pending
	waiters map[string]map[*websocket.Conn]struct{}
}

// pending is a phone pipe waiting for the host to accept it.
type pending struct {
	conn chan *websocket.Conn // receives the host side, buffered
	done chan struct{}        // closed when the splice ends
}

func NewRelay(token string, trustProxy bool, logger *log.Logger) *Relay {
	if logger == nil {
		logger = log.New(io.Discard, "", 0)
	}
	return &Relay{
		token:      sha256.Sum256([]byte(token)),
		trustProxy: trustProxy,
		pingEvery:  defaultPing,
		acceptWait: defaultAccept,
		log:        logger,
		limiter:    newLimiter(pipesPerMinute, time.Minute),
		rooms:      map[string]*room{},
	}
}

func (r *Relay) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", r.health)
	mux.HandleFunc("GET /v1/host", r.host)
	mux.HandleFunc("GET /v1/accept", r.accept)
	mux.HandleFunc("GET /v1/connect", r.connect)
	mux.HandleFunc("GET /v1/wait", r.wait)
	mux.HandleFunc("POST /v1/notify", r.notify)
	return mux
}

func (r *Relay) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": version})
}

// host is Orbit's control socket for a room. A newer one replaces it.
func (r *Relay) host(w http.ResponseWriter, req *http.Request) {
	if !r.authorized(w, req) {
		return
	}
	id, ok := param(w, req, "room")
	if !ok {
		return
	}
	c, err := upgrade(w, req)
	if err != nil {
		return
	}
	r.mu.Lock()
	rm := r.roomLocked(id)
	old := rm.host
	rm.host = c
	r.mu.Unlock()
	if old != nil {
		go old.Close(statusReplaced, "replaced by a new host")
	}

	start := time.Now()
	r.log.Printf("host open room=%s ip=%s", short(id), r.clientIP(req))
	ctx, cancel := context.WithCancel(context.Background())
	go r.keepalive(ctx, c, true)
	err = drain(c)
	cancel()

	r.mu.Lock()
	if rm.host == c {
		rm.host = nil
	}
	r.gcLocked(id, rm)
	r.mu.Unlock()
	c.CloseNow()
	r.log.Printf("host close room=%s after=%s %s", short(id), since(start), closeInfo(err))
}

// connect is one phone pipe. It is spliced to the host's accept socket.
func (r *Relay) connect(w http.ResponseWriter, req *http.Request) {
	id, ok := param(w, req, "room")
	if !ok {
		return
	}
	ip := r.clientIP(req)
	if !r.limiter.allow(ip) {
		httpError(w, http.StatusTooManyRequests, "too many pipes, try again in a minute")
		return
	}
	rm, ok := r.addPhone(w, id)
	if !ok {
		return
	}
	defer r.dropPhone(id, rm)
	c, err := upgrade(w, req)
	if err != nil {
		return
	}
	chanID := randomID()
	start := time.Now()
	r.log.Printf("pipe open room=%s chan=%s ip=%s", short(id), short(chanID), ip)

	// The phone speaks first, usually before the host has accepted, so its
	// socket is read from the start and early frames are kept for the host.
	phone := startReader(c)
	defer phone.stop()
	hc, early, done, err := r.waitForHost(rm, chanID, phone)
	defer close(done)
	switch {
	case errors.Is(err, errNoHost):
		c.Close(statusNoHost, "host not available")
	case errors.Is(err, errTooEarly):
		c.Close(websocket.StatusMessageTooBig, "too much sent before the host accepted")
	case err != nil:
		c.CloseNow()
	}
	if err != nil {
		r.log.Printf("pipe close room=%s chan=%s after=%s %v", short(id), short(chanID), since(start), err)
		return
	}
	err = r.splice(c, phone, early, hc)
	r.log.Printf("pipe close room=%s chan=%s after=%s %s", short(id), short(chanID), since(start), closeInfo(err))
}

var (
	errNoHost    = errors.New("code=4404 host not available")
	errTooEarly  = errors.New("code=1009 too much sent before the host accepted")
	errPhoneGone = errors.New("phone left before the host accepted")
)

// waitForHost asks the room's host to accept a new pipe and waits for it,
// keeping what the phone sends meanwhile (at most maxEarly messages and
// maxMessage bytes). It also returns a channel to close once the pipe ends,
// which releases the accept handler.
func (r *Relay) waitForHost(rm *room, chanID string, phone *reader) (*websocket.Conn, []frame, chan struct{}, error) {
	p := &pending{conn: make(chan *websocket.Conn, 1), done: make(chan struct{})}
	r.mu.Lock()
	host := rm.host
	if host != nil {
		rm.pending[chanID] = p
	}
	r.mu.Unlock()
	if host == nil {
		return nil, nil, p.done, errNoHost
	}

	var (
		hc    *websocket.Conn
		early []frame
		size  int
		fail  error
	)
	msg, _ := json.Marshal(map[string]string{"type": "open", "chan": chanID})
	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	if host.Write(ctx, websocket.MessageText, msg) != nil {
		fail = errNoHost
	}
	cancel()
	timer := time.NewTimer(r.acceptWait)
	defer timer.Stop()
	for fail == nil && hc == nil {
		select {
		case hc = <-p.conn:
		case <-timer.C:
			fail = errNoHost
		case f, ok := <-phone.frames:
			if !ok {
				fail = errPhoneGone
				break
			}
			early = append(early, f)
			size += len(f.data)
			if len(early) > maxEarly || size > maxMessage {
				fail = errTooEarly
			}
		}
	}
	if hc == nil {
		// Whoever removes the pending entry first wins. If accept already
		// took it, its socket is in the buffered channel.
		r.mu.Lock()
		if rm.pending[chanID] == p {
			delete(rm.pending, chanID)
		} else {
			hc = <-p.conn
		}
		r.mu.Unlock()
	}
	switch {
	case hc != nil && errors.Is(fail, errNoHost):
		fail = nil // accepted just in time
	case hc != nil && fail != nil:
		hc.CloseNow()
		hc = nil
	}
	return hc, early, p.done, fail
}

// accept is the host side of one phone pipe.
func (r *Relay) accept(w http.ResponseWriter, req *http.Request) {
	if !r.authorized(w, req) {
		return
	}
	id, ok := param(w, req, "room")
	if !ok {
		return
	}
	chanID, ok := param(w, req, "chan")
	if !ok {
		return
	}
	r.mu.Lock()
	var p *pending
	if rm := r.rooms[id]; rm != nil {
		p = rm.pending[chanID]
	}
	r.mu.Unlock()
	if p == nil {
		httpError(w, http.StatusNotFound, "no such pipe")
		return
	}
	c, err := upgrade(w, req)
	if err != nil {
		return
	}
	taken := false
	r.mu.Lock()
	if rm := r.rooms[id]; rm != nil && rm.pending[chanID] == p {
		delete(rm.pending, chanID)
		p.conn <- c
		taken = true
	}
	r.mu.Unlock()
	if !taken {
		c.Close(statusNoHost, "pipe gone")
		return
	}
	<-p.done
}

// wait is a phone's alert socket.
func (r *Relay) wait(w http.ResponseWriter, req *http.Request) {
	id, ok := param(w, req, "room")
	if !ok {
		return
	}
	device, ok := param(w, req, "device")
	if !ok {
		return
	}
	rm, ok := r.addPhone(w, id)
	if !ok {
		return
	}
	defer r.dropPhone(id, rm)
	c, err := upgrade(w, req)
	if err != nil {
		return
	}
	r.mu.Lock()
	set := rm.waiters[device]
	if set == nil {
		set = map[*websocket.Conn]struct{}{}
		rm.waiters[device] = set
	}
	set[c] = struct{}{}
	r.mu.Unlock()

	start := time.Now()
	r.log.Printf("wait open room=%s device=%s ip=%s", short(id), short(device), r.clientIP(req))
	ctx, cancel := context.WithCancel(context.Background())
	go r.keepalive(ctx, c, true)
	err = drain(c)
	cancel()

	r.mu.Lock()
	delete(set, c)
	if len(set) == 0 {
		delete(rm.waiters, device)
	}
	r.mu.Unlock()
	c.CloseNow()
	r.log.Printf("wait close room=%s device=%s after=%s %s", short(id), short(device), since(start), closeInfo(err))
}

// notify forwards a sealed alert to every wait socket of one device.
func (r *Relay) notify(w http.ResponseWriter, req *http.Request) {
	if !r.authorized(w, req) {
		return
	}
	id, ok := param(w, req, "room")
	if !ok {
		return
	}
	device, ok := param(w, req, "device")
	if !ok {
		return
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(10 * time.Second))
	body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxNotify))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			httpError(w, http.StatusRequestEntityTooLarge, "body over 4 KiB")
		} else {
			httpError(w, http.StatusBadRequest, "could not read body")
		}
		return
	}
	if len(body) == 0 {
		httpError(w, http.StatusBadRequest, "empty body")
		return
	}

	var targets []*websocket.Conn
	r.mu.Lock()
	if rm := r.rooms[id]; rm != nil {
		for c := range rm.waiters[device] {
			targets = append(targets, c)
		}
	}
	r.mu.Unlock()

	delivered := 0
	for _, c := range targets {
		ctx, cancel := context.WithTimeout(req.Context(), writeTimeout)
		if c.Write(ctx, websocket.MessageBinary, body) == nil {
			delivered++
		}
		cancel()
	}
	if delivered == 0 {
		httpError(w, http.StatusNotFound, "device not connected")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"delivered": delivered})
}

// splice forwards frames both ways, keeping their type, until one side
// closes: first the phone's early frames, then live traffic. The close code
// and reason are passed on to the other side.
func (r *Relay) splice(phone *websocket.Conn, rd *reader, early []frame, host *websocket.Conn) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.keepalive(ctx, phone, false)
	go r.keepalive(ctx, host, false)

	errc := make(chan error, 2)
	go func() { errc <- pumpFrames(host, early, rd) }()
	go func() { errc <- pump(phone, host) }()
	err := <-errc

	code, reason := statusGoingAway, "peer gone"
	var ce websocket.CloseError
	if errors.As(err, &ce) && sendable(ce.Code) {
		code, reason = ce.Code, ce.Reason
	} else if errors.As(err, &ce) {
		code, reason = websocket.StatusNormalClosure, ""
	}
	var wg sync.WaitGroup
	for _, c := range []*websocket.Conn{phone, host} {
		wg.Add(1)
		go func() { defer wg.Done(); c.Close(code, reason) }()
	}
	wg.Wait()
	rd.stop()
	<-errc
	return err
}

// pump copies messages from src to dst.
func pump(dst, src *websocket.Conn) error {
	for {
		typ, data, err := src.Read(context.Background())
		if err != nil {
			return err
		}
		if err := write(dst, frame{typ, data}); err != nil {
			return err
		}
	}
}

// pumpFrames writes the early frames to dst, then everything rd reads.
func pumpFrames(dst *websocket.Conn, early []frame, rd *reader) error {
	for _, f := range early {
		if err := write(dst, f); err != nil {
			return err
		}
	}
	for f := range rd.frames {
		if err := write(dst, f); err != nil {
			return err
		}
	}
	return rd.err
}

func write(dst *websocket.Conn, f frame) error {
	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	defer cancel()
	return dst.Write(ctx, f.typ, f.data)
}

type frame struct {
	typ  websocket.MessageType
	data []byte
}

// reader reads a socket on its own goroutine. frames is closed when reading
// ends, and err then says why.
type reader struct {
	frames chan frame
	err    error
	quit   chan struct{}
	once   sync.Once
}

func startReader(c *websocket.Conn) *reader {
	rd := &reader{frames: make(chan frame), quit: make(chan struct{})}
	go func() {
		defer close(rd.frames)
		for {
			typ, data, err := c.Read(context.Background())
			if err != nil {
				rd.err = err
				return
			}
			select {
			case rd.frames <- frame{typ, data}:
			case <-rd.quit:
				rd.err = net.ErrClosed
				return
			}
		}
	}()
	return rd
}

// stop releases the reading goroutine when nobody takes its frames any more.
func (rd *reader) stop() { rd.once.Do(func() { close(rd.quit) }) }

// keepalive pings every pingEvery until ctx ends. With app set it first sends
// the {"type":"ping"} text frame from the spec. The websocket ping that follows
// finds dead connections, since every client answers it on its own.
func (r *Relay) keepalive(ctx context.Context, c *websocket.Conn, app bool) {
	t := time.NewTicker(r.pingEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if app {
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.Write(wctx, websocket.MessageText, []byte(`{"type":"ping"}`))
			cancel()
			if err != nil {
				c.CloseNow()
				return
			}
		}
		pctx, cancel := context.WithTimeout(ctx, pingTimeout)
		err := c.Ping(pctx)
		cancel()
		if err != nil && ctx.Err() == nil {
			c.CloseNow()
			return
		}
	}
}

// drain reads and drops messages (pongs) until the socket ends.
func drain(c *websocket.Conn) error {
	for {
		if _, _, err := c.Read(context.Background()); err != nil {
			return err
		}
	}
}

func (r *Relay) addPhone(w http.ResponseWriter, id string) (*room, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rm := r.roomLocked(id)
	if rm.phones >= maxPhones {
		r.gcLocked(id, rm)
		httpError(w, http.StatusTooManyRequests, "room is full")
		return nil, false
	}
	rm.phones++
	return rm, true
}

func (r *Relay) dropPhone(id string, rm *room) {
	r.mu.Lock()
	rm.phones--
	r.gcLocked(id, rm)
	r.mu.Unlock()
}

func (r *Relay) roomLocked(id string) *room {
	rm := r.rooms[id]
	if rm == nil {
		rm = &room{pending: map[string]*pending{}, waiters: map[string]map[*websocket.Conn]struct{}{}}
		r.rooms[id] = rm
	}
	return rm
}

func (r *Relay) gcLocked(id string, rm *room) {
	if r.rooms[id] == rm && rm.host == nil && rm.phones == 0 && len(rm.pending) == 0 && len(rm.waiters) == 0 {
		delete(r.rooms, id)
	}
}

// authorized checks the bearer token in constant time and answers 401 if wrong.
func (r *Relay) authorized(w http.ResponseWriter, req *http.Request) bool {
	given, ok := strings.CutPrefix(req.Header.Get("Authorization"), "Bearer ")
	sum := sha256.Sum256([]byte(strings.TrimSpace(given)))
	if ok && subtle.ConstantTimeCompare(sum[:], r.token[:]) == 1 {
		return true
	}
	httpError(w, http.StatusUnauthorized, "relay token missing or wrong")
	return false
}

// clientIP is the peer address, or behind a proxy the address the proxy
// appended last to X-Forwarded-For.
func (r *Relay) clientIP(req *http.Request) string {
	if r.trustProxy {
		xff := strings.Join(req.Header.Values("X-Forwarded-For"), ",")
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			if ip := strings.TrimSpace(parts[i]); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}

func upgrade(w http.ResponseWriter, req *http.Request) (*websocket.Conn, error) {
	c, err := websocket.Accept(w, req, &websocket.AcceptOptions{
		// Phones are apps, not web pages, and host endpoints need a token
		// that browsers cannot attach to a websocket, so Origin is not checked.
		InsecureSkipVerify: true,
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		return nil, err
	}
	c.SetReadLimit(maxMessage)
	return c, nil
}

// param reads a room, device or channel id: base64url, 1 to 64 characters.
func param(w http.ResponseWriter, req *http.Request, name string) (string, bool) {
	v := req.URL.Query().Get(name)
	ok := len(v) > 0 && len(v) <= 64
	for i := 0; ok && i < len(v); i++ {
		ch := v[i]
		ok = ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_'
	}
	if !ok {
		httpError(w, http.StatusBadRequest, "missing or bad "+name)
	}
	return v, ok
}

func randomID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// sendable reports whether a close code may be sent in a close frame.
func sendable(c websocket.StatusCode) bool {
	return c >= 1000 && c <= 1003 || c >= 1007 && c <= 1014 || c >= 3000 && c <= 4999
}

func closeInfo(err error) string {
	var ce websocket.CloseError
	if errors.As(err, &ce) {
		return fmt.Sprintf("code=%d", int(ce.Code))
	}
	return "code=none"
}

func short(s string) string {
	if len(s) > 6 {
		return s[:6]
	}
	return s
}

func since(t time.Time) time.Duration { return time.Since(t).Round(time.Second) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": msg})
}
