package realdebrid

import (
	"fmt"
	"sync"

	"cinesync/pkg/logger"
)

// Token represents a single API token with its expiration state
type Token struct {
	Value   string
	Expired bool
	Label   string
}

// TokenManager manages multiple Real-Debrid API tokens with automatic rotation
type TokenManager struct {
	tokens  []Token
	current int
	mu      sync.RWMutex
}

// NewTokenManager initializes a new TokenManager with the given tokens
func NewTokenManager(tokenStrings []string) *TokenManager {
	tokens := make([]Token, len(tokenStrings))
	for i, t := range tokenStrings {
		label := "Main"
		if i > 0 {
			label = fmt.Sprintf("Backup %d", i)
		}
		tokens[i] = Token{
			Value:   t,
			Expired: false,
			Label:   label,
		}
	}
	return &TokenManager{
		tokens:  tokens,
		current: 0,
	}
}

// GetCurrentToken returns the current non-expired token
func (tm *TokenManager) GetCurrentToken() (string, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if len(tm.tokens) == 0 {
		return "", fmt.Errorf("no tokens available")
	}

	startIndex := tm.current
	for {
		if !tm.tokens[tm.current].Expired {
			return tm.tokens[tm.current].Value, nil
		}

		tm.current = (tm.current + 1) % len(tm.tokens)

		if tm.current == startIndex {
			return "", fmt.Errorf("all tokens are expired")
		}
	}
}

// SetTokenAsExpired marks the specified token as expired
func (tm *TokenManager) SetTokenAsExpired(token, reason string) error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	for i, t := range tm.tokens {
		if t.Value == token {
			if !tm.tokens[i].Expired {
				logger.Warn("Token %s (%s) expired: %s", maskToken(token), t.Label, reason)
			}
			tm.tokens[i].Expired = true
			return nil
		}
	}

	return fmt.Errorf("token not found")
}

// SetTokenAsUnexpired marks the specified token as unexpired
func (tm *TokenManager) SetTokenAsUnexpired(token string) error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	for i, t := range tm.tokens {
		if t.Value == token {
			if tm.tokens[i].Expired {
				logger.Info("Token %s (%s) recovered", maskToken(token), t.Label)
			}
			tm.tokens[i].Expired = false
			return nil
		}
	}

	return fmt.Errorf("token not found")
}

// ResetAllTokens resets all tokens to unexpired state
func (tm *TokenManager) ResetAllTokens() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	expiredCount := 0
	for i := range tm.tokens {
		if tm.tokens[i].Expired {
			expiredCount++
		}
		tm.tokens[i].Expired = false
	}
	tm.current = 0
	
	if expiredCount > 0 {
		logger.Info("Daily bandwidth reset: %d token(s) restored", expiredCount)
	}
}

// GetExpiredTokens returns a list of expired tokens
func (tm *TokenManager) GetExpiredTokens() []string {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	var tokens []string
	for _, t := range tm.tokens {
		if t.Expired {
			tokens = append(tokens, t.Value)
		}
	}
	return tokens
}

// GetAllTokens returns all token values
func (tm *TokenManager) GetAllTokens() []string {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	var tokens []string
	for _, t := range tm.tokens {
		tokens = append(tokens, t.Value)
	}
	return tokens
}

// GetTokensStatus returns the status of all tokens
func (tm *TokenManager) GetTokensStatus() []TokenStatus {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	statuses := make([]TokenStatus, len(tm.tokens))
	for i, t := range tm.tokens {
		statuses[i] = TokenStatus{
			Label:   t.Label,
			Expired: t.Expired,
			Current: i == tm.current,
			Masked:  maskToken(t.Value),
		}
	}
	return statuses
}

// TokenStatus represents the status of a token for API responses
type TokenStatus struct {
	Label   string `json:"label"`
	Expired bool   `json:"expired"`
	Current bool   `json:"current"`
	Masked  string `json:"masked"`
}

// AreAllTokensExpired checks if all tokens are expired
func (tm *TokenManager) AreAllTokensExpired() bool {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	for _, t := range tm.tokens {
		if !t.Expired {
			return false
		}
	}
	return true
}

// maskToken masks most of the token for display purposes
func maskToken(token string) string {
	if len(token) <= 8 {
		return "****"
	}
	return token[:4] + "****" + token[len(token)-4:]
}

