package main

import (
	"sync"
	"time"
)

// limiter is a token bucket per key: n tokens, refilled evenly over per.
type limiter struct {
	mu        sync.Mutex
	burst     float64
	rate      float64 // tokens per second
	buckets   map[string]*bucket
	lastPrune time.Time
	now       func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newLimiter(n int, per time.Duration) *limiter {
	return &limiter{
		burst:   float64(n),
		rate:    float64(n) / per.Seconds(),
		buckets: map[string]*bucket{},
		now:     time.Now,
	}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	full := time.Duration(l.burst / l.rate * float64(time.Second))
	if now.Sub(l.lastPrune) > full {
		// Buckets idle this long are full again and can be forgotten.
		for k, b := range l.buckets {
			if now.Sub(b.last) > full {
				delete(l.buckets, k)
			}
		}
		l.lastPrune = now
	}
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
