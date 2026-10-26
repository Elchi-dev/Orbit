// Command orbit-relay passes sealed messages between Orbit and the Orbit app
// on a phone. It cannot read them: see docs/REMOTE.md.
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

// version is set at build time with -ldflags "-X main.version=v1.2.3".
var version = "dev"

const (
	defaultTokenFile = "/etc/orbit-relay/token"
	defaultCertDir   = "/var/lib/orbit-relay/certs"
	serviceName      = "orbit-relay"
	unitFile         = "/etc/systemd/system/orbit-relay.service"
)

const usage = `orbit-relay passes end to end encrypted messages between Orbit and its phone app.

Usage:
  orbit-relay serve --domain relay.example.com     TLS on :443 with a Let's Encrypt certificate
  orbit-relay serve --behind-proxy --port 8787     plain HTTP on 127.0.0.1 behind nginx or Caddy
  orbit-relay token [--rotate]                     print the relay token, or make a new one
  orbit-relay version                              print the version
  orbit-relay uninstall [--yes]                    remove the service, user, binary and data

Common flags:
  --token-file PATH   relay token (default /etc/orbit-relay/token)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(os.Args[2:])
	case "token":
		err = tokenCmd(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Println(version)
	case "uninstall":
		err = uninstall(os.Args[2:])
	case "help", "--help", "-h":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "orbit-relay:", err)
		os.Exit(1)
	}
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	domain := fs.String("domain", "", "public domain name, enables TLS on :443 and the ACME challenge on :80")
	behind := fs.Bool("behind-proxy", false, "listen with plain HTTP on 127.0.0.1 and trust X-Forwarded-For")
	port := fs.Int("port", 8787, "port to listen on with --behind-proxy")
	tokenFile := fs.String("token-file", defaultTokenFile, "file holding the relay token")
	certDir := fs.String("cert-dir", defaultCertDir, "certificate cache for --domain")
	email := fs.String("email", "", "optional contact address for Let's Encrypt")
	_ = fs.Parse(args)

	if (*domain == "") == !*behind {
		return errors.New("give either --domain NAME or --behind-proxy")
	}
	token, err := readToken(*tokenFile)
	if err != nil {
		return err
	}
	logger := log.New(os.Stderr, "", log.LstdFlags)
	relay := NewRelay(token, *behind, logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	errc := make(chan error, 2)
	var servers []*http.Server

	if *behind {
		addr := "127.0.0.1:" + strconv.Itoa(*port)
		srv := newServer(addr, relay.Handler())
		servers = append(servers, srv)
		logger.Printf("orbit-relay %s listening on http://%s (behind a proxy)", version, addr)
		go func() { errc <- srv.ListenAndServe() }()
	} else {
		m := &autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(*domain),
			Cache:      autocert.DirCache(*certDir),
			Email:      *email,
		}
		web := newServer(":80", m.HTTPHandler(nil))
		tlsSrv := newServer(":443", relay.Handler())
		tlsSrv.TLSConfig = m.TLSConfig()
		tlsSrv.TLSConfig.MinVersion = tls.VersionTLS12
		servers = append(servers, web, tlsSrv)
		logger.Printf("orbit-relay %s listening on https://%s", version, *domain)
		go func() { errc <- web.ListenAndServe() }()
		go func() { errc <- tlsSrv.ListenAndServeTLS("", "") }()
	}

	select {
	case err = <-errc:
	case <-ctx.Done():
		logger.Printf("shutting down")
		err = nil
	}
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, s := range servers {
		_ = s.Shutdown(sctx)
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func newServer(addr string, h http.Handler) *http.Server {
	// No ReadTimeout or WriteTimeout: they would cut long lived websockets.
	// Those keep their own per message timeouts and pings.
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          log.New(discardTLSNoise{}, "", 0),
	}
}

// discardTLSNoise drops the handshake errors scanners cause all day long.
type discardTLSNoise struct{}

func (discardTLSNoise) Write(p []byte) (int, error) {
	if !strings.Contains(string(p), "TLS handshake error") {
		_, _ = os.Stderr.Write(p)
	}
	return len(p), nil
}

func tokenCmd(args []string) error {
	fs := flag.NewFlagSet("token", flag.ExitOnError)
	rotate := fs.Bool("rotate", false, "replace the token with a new one and restart the service")
	tokenFile := fs.String("token-file", defaultTokenFile, "file holding the relay token")
	_ = fs.Parse(args)

	if !*rotate {
		t, err := readToken(*tokenFile)
		if err != nil {
			return err
		}
		fmt.Println(t)
		return nil
	}
	t, err := writeToken(*tokenFile)
	if err != nil {
		return err
	}
	fmt.Println(t)
	if exec.Command("systemctl", "is-active", "--quiet", serviceName).Run() == nil {
		if err := exec.Command("systemctl", "restart", serviceName).Run(); err != nil {
			return fmt.Errorf("new token written, but restarting the service failed: %w", err)
		}
		fmt.Fprintln(os.Stderr, "Service restarted. Paste the new token in Orbit, Settings, Remote.")
	}
	return nil
}

func readToken(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("cannot read the relay token: %w (make one with: orbit-relay token --rotate)", err)
	}
	t := strings.TrimSpace(string(b))
	if len(t) < 16 {
		return "", fmt.Errorf("the relay token in %s is missing or too short", path)
	}
	return t, nil
}

// writeToken stores a new random token, readable by the owner and by the
// group of its directory (the service user's group after install).
func writeToken(path string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	t := base64.RawURLEncoding.EncodeToString(b)
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	tmp := path + ".new"
	if err := os.WriteFile(tmp, []byte(t+"\n"), 0o640); err != nil {
		return "", err
	}
	if st, err := os.Stat(dir); err == nil {
		if sys, ok := st.Sys().(*syscall.Stat_t); ok && os.Geteuid() == 0 {
			_ = os.Chown(tmp, 0, int(sys.Gid))
		}
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", err
	}
	return t, nil
}

func uninstall(args []string) error {
	fs := flag.NewFlagSet("uninstall", flag.ExitOnError)
	yes := fs.Bool("yes", false, "do not ask for confirmation")
	_ = fs.Parse(args)
	if os.Geteuid() != 0 {
		return errors.New("run as root: sudo orbit-relay uninstall")
	}
	bin, err := os.Executable()
	if err == nil {
		bin, _ = filepath.EvalSymlinks(bin)
	}
	if bin == "" {
		bin = "/usr/local/bin/orbit-relay"
	}
	fmt.Printf("This removes the orbit-relay service, the orbit-relay user, %s,\n/etc/orbit-relay (with the token) and /var/lib/orbit-relay (with the certificates).\n", bin)
	if !*yes {
		fmt.Print("Continue? [y/N] ")
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		if a := strings.ToLower(strings.TrimSpace(line)); a != "y" && a != "yes" {
			fmt.Println("Nothing removed.")
			return nil
		}
	}
	step := func(what string, err error) {
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			fmt.Printf("  %s: %v\n", what, err)
		} else {
			fmt.Printf("  %s\n", what)
		}
	}
	_ = exec.Command("systemctl", "disable", "--now", serviceName).Run()
	step("stopped and disabled the service", nil)
	step("removed "+unitFile, os.Remove(unitFile))
	_ = exec.Command("systemctl", "daemon-reload").Run()
	if exec.Command("id", "-u", serviceName).Run() == nil {
		step("removed the user "+serviceName, exec.Command("userdel", serviceName).Run())
	}
	step("removed /etc/orbit-relay", os.RemoveAll("/etc/orbit-relay"))
	step("removed /var/lib/orbit-relay", os.RemoveAll("/var/lib/orbit-relay"))
	step("removed "+bin, os.Remove(bin))
	fmt.Println("orbit-relay is uninstalled.")
	return nil
}
