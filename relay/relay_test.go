package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const testToken = "test-token-0123456789abcdef"

func newTestRelay(t *testing.T) (*Relay, *httptest.Server) {
	t.Helper()
	r := NewRelay(testToken, false, nil)
	r.acceptWait = 2 * time.Second
	srv := httptest.NewServer(r.Handler())
	t.Cleanup(srv.Close)
	return r, srv
}

func wsURL(srv *httptest.Server, path string) string {
	return "ws" + strings.TrimPrefix(srv.URL, "http") + path
}

func ctxT(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func dial(t *testing.T, srv *httptest.Server, path, token string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	opts := &websocket.DialOptions{HTTPHeader: http.Header{}}
	if token != "" {
		opts.HTTPHeader.Set("Authorization", "Bearer "+token)
	}
	c, resp, err := websocket.Dial(ctxT(t), wsURL(srv, path), opts)
	if c != nil {
		c.SetReadLimit(maxMessage)
		t.Cleanup(func() { c.CloseNow() })
	}
	return c, resp, err
}

func mustDial(t *testing.T, srv *httptest.Server, path, token string) *websocket.Conn {
	t.Helper()
	c, _, err := dial(t, srv, path, token)
	if err != nil {
		t.Fatalf("dial %s: %v", path, err)
	}
	return c
}

// dialHost connects a host and waits until the relay has registered it, so a
// phone dialled right after is routed to it rather than told there is no host.
func dialHost(t *testing.T, r *Relay, srv *httptest.Server, room string) *websocket.Conn {
	t.Helper()
	before := hostOf(r, room)
	c := mustDial(t, srv, "/v1/host?room="+room, testToken)
	eventually(t, func() bool { h := hostOf(r, room); return h != nil && h != before })
	return c
}

// readOpen reads the next control message on a host socket and returns its channel id.
func readOpen(t *testing.T, host *websocket.Conn) string {
	t.Helper()
	typ, data, err := host.Read(ctxT(t))
	if err != nil {
		t.Fatalf("host read: %v", err)
	}
	var m struct{ Type, Chan string }
	if typ != websocket.MessageText || json.Unmarshal(data, &m) != nil || m.Type != "open" || m.Chan == "" {
		t.Fatalf("want an open message, got %v %q", typ, data)
	}
	return m.Chan
}

func expect(t *testing.T, c *websocket.Conn, typ websocket.MessageType, want []byte) {
	t.Helper()
	gotTyp, got, err := c.Read(ctxT(t))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if gotTyp != typ || !bytes.Equal(got, want) {
		t.Fatalf("got %v %q, want %v %q", gotTyp, got, typ, want)
	}
}

func expectClose(t *testing.T, c *websocket.Conn, code websocket.StatusCode) {
	t.Helper()
	for {
		_, _, err := c.Read(ctxT(t))
		if err == nil {
			continue
		}
		if got := websocket.CloseStatus(err); got != code {
			t.Fatalf("closed with %v (%v), want %v", got, err, code)
		}
		return
	}
}

func eventually(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}

func hostOf(r *Relay, room string) *websocket.Conn {
	r.mu.Lock()
	defer r.mu.Unlock()
	if rm := r.rooms[room]; rm != nil {
		return rm.host
	}
	return nil
}

func TestHealth(t *testing.T) {
	_, srv := newTestRelay(t)
	resp, err := http.Get(srv.URL + "/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(resp.Body).Decode(&body) != nil || !body.OK || body.Version == "" {
		t.Fatalf("health: %d %+v", resp.StatusCode, body)
	}
}

func TestHostAuth(t *testing.T) {
	_, srv := newTestRelay(t)
	for _, tok := range []string{"", "wrong-token-0123456789abcdef", testToken + "x"} {
		_, resp, err := dial(t, srv, "/v1/host?room=r1", tok)
		if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("token %q: want 401, got %v %v", tok, resp, err)
		}
		_, resp, err = dial(t, srv, "/v1/accept?room=r1&chan=c1", tok)
		if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("accept with token %q: want 401, got %v %v", tok, resp, err)
		}
	}
	mustDial(t, srv, "/v1/host?room=r1", testToken)
}

func TestPipeSplice(t *testing.T) {
	r, srv := newTestRelay(t)
	host := dialHost(t, r, srv, "room1")
	phone := mustDial(t, srv, "/v1/connect?room=room1", "")
	ch := readOpen(t, host)
	pipe := mustDial(t, srv, "/v1/accept?room=room1&chan="+ch, testToken)
	ctx := ctxT(t)

	bin := []byte{0, 1, 2, 255, 254, 0, 10}
	big := bytes.Repeat([]byte{7}, 900<<10)
	for _, m := range []struct {
		typ  websocket.MessageType
		data []byte
	}{
		{websocket.MessageText, []byte(`{"v":1}`)},
		{websocket.MessageBinary, bin},
		{websocket.MessageBinary, big},
	} {
		if err := phone.Write(ctx, m.typ, m.data); err != nil {
			t.Fatal(err)
		}
		expect(t, pipe, m.typ, m.data)
		if err := pipe.Write(ctx, m.typ, m.data); err != nil {
			t.Fatal(err)
		}
		expect(t, phone, m.typ, m.data)
	}

	// Closing one side closes the other with the same code.
	if err := pipe.Close(4001, "bye"); err != nil {
		t.Fatal(err)
	}
	expectClose(t, phone, 4001)
}

func TestEarlyFramesAreKept(t *testing.T) {
	r, srv := newTestRelay(t)
	host := dialHost(t, r, srv, "room1")
	phone := mustDial(t, srv, "/v1/connect?room=room1", "")
	ctx := ctxT(t)
	hello := []byte(`{"v":1,"d":"x"}`)
	sealed := []byte{9, 8, 7, 0}
	if err := phone.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	if err := phone.Write(ctx, websocket.MessageBinary, sealed); err != nil {
		t.Fatal(err)
	}
	ch := readOpen(t, host)
	time.Sleep(300 * time.Millisecond) // the host takes its time
	pipe := mustDial(t, srv, "/v1/accept?room=room1&chan="+ch, testToken)
	expect(t, pipe, websocket.MessageText, hello)
	expect(t, pipe, websocket.MessageBinary, sealed)

	// Live traffic follows the early frames.
	if err := phone.Write(ctx, websocket.MessageBinary, []byte("live")); err != nil {
		t.Fatal(err)
	}
	expect(t, pipe, websocket.MessageBinary, []byte("live"))
}

func TestEarlyFramesOverLimit(t *testing.T) {
	r, srv := newTestRelay(t)
	host := dialHost(t, r, srv, "room1")
	phone := mustDial(t, srv, "/v1/connect?room=room1", "")
	readOpen(t, host)
	ctx := ctxT(t)
	for i := 0; i <= maxEarly; i++ {
		if err := phone.Write(ctx, websocket.MessageBinary, []byte{byte(i)}); err != nil {
			break
		}
	}
	expectClose(t, phone, websocket.StatusMessageTooBig)
}

func TestConnectWithoutHost(t *testing.T) {
	_, srv := newTestRelay(t)
	phone := mustDial(t, srv, "/v1/connect?room=nobody", "")
	expectClose(t, phone, statusNoHost)
}

func TestConnectHostDoesNotAccept(t *testing.T) {
	r, srv := newTestRelay(t)
	r.acceptWait = 200 * time.Millisecond
	host := dialHost(t, r, srv, "room1")
	phone := mustDial(t, srv, "/v1/connect?room=room1", "")
	ch := readOpen(t, host)
	expectClose(t, phone, statusNoHost)
	// A late accept finds nothing.
	_, resp, err := dial(t, srv, "/v1/accept?room=room1&chan="+ch, testToken)
	if err == nil || resp == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("late accept: want 404, got %v %v", resp, err)
	}
}

func notify(t *testing.T, srv *httptest.Server, device, token string, body []byte) int {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+"/v1/notify?room=room1&device="+device, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp.StatusCode
}

func TestNotify(t *testing.T) {
	r, srv := newTestRelay(t)
	alert := []byte{1, 2, 3, 0, 200}
	if got := notify(t, srv, "dev1", testToken, alert); got != http.StatusNotFound {
		t.Fatalf("no device: got %d, want 404", got)
	}
	phone := mustDial(t, srv, "/v1/wait?room=room1&device=dev1", "")
	eventually(t, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.rooms["room1"] != nil && len(r.rooms["room1"].waiters["dev1"]) == 1
	})
	if got := notify(t, srv, "dev1", "", alert); got != http.StatusUnauthorized {
		t.Fatalf("no token: got %d, want 401", got)
	}
	if got := notify(t, srv, "dev1", testToken, bytes.Repeat([]byte{1}, maxNotify+1)); got != http.StatusRequestEntityTooLarge {
		t.Fatalf("big body: got %d, want 413", got)
	}
	if got := notify(t, srv, "dev2", testToken, alert); got != http.StatusNotFound {
		t.Fatalf("other device: got %d, want 404", got)
	}
	if got := notify(t, srv, "dev1", testToken, alert); got != http.StatusAccepted {
		t.Fatalf("waiting device: got %d, want 202", got)
	}
	expect(t, phone, websocket.MessageBinary, alert)
}

func TestPhoneLimit(t *testing.T) {
	_, srv := newTestRelay(t)
	for i := 0; i < maxPhones; i++ {
		mustDial(t, srv, fmt.Sprintf("/v1/wait?room=room1&device=d%d", i), "")
	}
	for _, path := range []string{"/v1/wait?room=room1&device=extra", "/v1/connect?room=room1"} {
		_, resp, err := dial(t, srv, path, "")
		if err == nil || resp == nil || resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("%s: want 429, got %v %v", path, resp, err)
		}
	}
	// Other rooms are not affected.
	mustDial(t, srv, "/v1/wait?room=room2&device=d0", "")
}

func TestPipeRateLimit(t *testing.T) {
	_, srv := newTestRelay(t)
	for i := 0; i < pipesPerMinute; i++ {
		phone := mustDial(t, srv, "/v1/connect?room=r", "")
		expectClose(t, phone, statusNoHost)
	}
	_, resp, err := dial(t, srv, "/v1/connect?room=r", "")
	if err == nil || resp == nil || resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %v %v", resp, err)
	}
}

func TestLimiterRefills(t *testing.T) {
	now := time.Unix(1000, 0)
	l := newLimiter(16, time.Minute)
	l.now = func() time.Time { return now }
	for i := 0; i < 16; i++ {
		if !l.allow("a") {
			t.Fatalf("open %d refused", i)
		}
	}
	if l.allow("a") {
		t.Fatal("17th open allowed")
	}
	if !l.allow("b") {
		t.Fatal("other IP refused")
	}
	now = now.Add(4 * time.Second) // one token back
	if !l.allow("a") || l.allow("a") {
		t.Fatal("refill is wrong")
	}
}

func TestSecondHostReplacesFirst(t *testing.T) {
	r, srv := newTestRelay(t)
	first := dialHost(t, r, srv, "room1")
	second := dialHost(t, r, srv, "room1")
	expectClose(t, first, statusReplaced)
	mustDial(t, srv, "/v1/connect?room=room1", "")
	readOpen(t, second)
}

func TestClientIP(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.1:5000"
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 1.2.3.4")
	if got := NewRelay(testToken, false, nil).clientIP(req); got != "10.0.0.1" {
		t.Fatalf("direct: got %s", got)
	}
	if got := NewRelay(testToken, true, nil).clientIP(req); got != "1.2.3.4" {
		t.Fatalf("behind proxy: got %s", got)
	}
}

func TestBadParams(t *testing.T) {
	_, srv := newTestRelay(t)
	for _, path := range []string{"/v1/connect", "/v1/connect?room=a%2Fb", "/v1/wait?room=r"} {
		_, resp, err := dial(t, srv, path, "")
		if err == nil || resp == nil || resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %v %v", path, resp, errors.Unwrap(err))
		}
	}
}

func TestHostGetsPings(t *testing.T) {
	r, srv := newTestRelay(t)
	r.pingEvery = 50 * time.Millisecond
	host := mustDial(t, srv, "/v1/host?room=room1", testToken)
	expect(t, host, websocket.MessageText, []byte(`{"type":"ping"}`))
	if err := host.Write(ctxT(t), websocket.MessageText, []byte(`{"type":"pong"}`)); err != nil {
		t.Fatal(err)
	}
	expect(t, host, websocket.MessageText, []byte(`{"type":"ping"}`))
}
