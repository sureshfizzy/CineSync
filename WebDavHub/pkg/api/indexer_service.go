package api

import (
	"bytes"
	"cinesync/pkg/logger"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// IndexerService handles indexer operations and testing
type IndexerService struct {
	client *http.Client
}

// NewIndexerService creates a new indexer service
func NewIndexerService() *IndexerService {
	return &IndexerService{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// TestResult represents the result of an indexer test
type TestResult struct {
	Status       string `json:"status"`
	Message      string `json:"message"`
	ResponseTime int    `json:"responseTimeMs"`
}

// SearchResult represents a search result from an indexer
type SearchResult struct {
	Title       string  `json:"title"`
	Size        int64   `json:"size"`
	Category    string  `json:"category"`
	PublishDate string  `json:"publishDate"`
	Link        string  `json:"link"`
	Magnet      string  `json:"magnet,omitempty"`
	Seeders     int     `json:"seeders,omitempty"`
	Leechers    int     `json:"leechers,omitempty"`
	Indexer     string  `json:"indexer"`
	IndexerID   int     `json:"indexerId"`
}

// Torznab caps XML structures (minimal)
type torznabCaps struct {
    XMLName   xml.Name        `xml:"caps"`
    Categories torznabCategories `xml:"categories"`
}
type torznabCategories struct {
    Category []torznabCategory `xml:"category"`
}
type torznabCategory struct {
    ID   int               `xml:"id,attr"`
    Name string            `xml:"name,attr"`
    Sub  []torznabSubCat   `xml:"subcat"`
}
type torznabSubCat struct {
    ID   int    `xml:"id,attr"`
    Name string `xml:"name,attr"`
}

// Public DTOs for caps
type IndexerCategory struct {
    ID   int               `json:"id"`
    Name string            `json:"name"`
    Subs []IndexerSubCat   `json:"subs,omitempty"`
}
type IndexerSubCat struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

// GetIndexerCaps fetches and parses Torznab/Newznab caps
func (s *IndexerService) GetIndexerCaps(indexer Indexer) ([]IndexerCategory, error) {
    capsURL := s.buildTorznabURL(indexer, "caps")

    req, err := http.NewRequest("GET", capsURL, nil)
    if err != nil { return nil, fmt.Errorf("caps request build failed: %w", err) }
    if indexer.APIKey != "" { req.Header.Set("X-API-Key", indexer.APIKey) }

    resp, err := s.client.Do(req)
    if err != nil { return nil, fmt.Errorf("caps request failed: %w", err) }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("caps HTTP %d", resp.StatusCode)
    }
    data, err := io.ReadAll(resp.Body)
    if err != nil { return nil, fmt.Errorf("caps read failed: %w", err) }

    var caps torznabCaps
    if err := xml.Unmarshal(data, &caps); err != nil {
        return nil, fmt.Errorf("caps parse failed: %w", err)
    }

    out := make([]IndexerCategory, 0, len(caps.Categories.Category))
    for _, c := range caps.Categories.Category {
        cat := IndexerCategory{ ID: c.ID, Name: c.Name }
        if len(c.Sub) > 0 {
            subs := make([]IndexerSubCat, 0, len(c.Sub))
            for _, sc := range c.Sub { subs = append(subs, IndexerSubCat{ ID: sc.ID, Name: sc.Name }) }
            cat.Subs = subs
        }
        out = append(out, cat)
    }
    return out, nil
}

// TorznabResponse represents a Torznab API response
type TorznabResponse struct {
	Channel struct {
		Title       string `xml:"title"`
		Description string `xml:"description"`
		Link        string `xml:"link"`
		Language    string `xml:"language"`
		Item        []struct {
			Title       string `xml:"title"`
			Description string `xml:"description"`
			Link        string `xml:"link"`
			Enclosure   struct {
				URL    string `xml:"url,attr"`
				Type   string `xml:"type,attr"`
				Length string `xml:"length,attr"`
			} `xml:"enclosure"`
			Category struct {
				Text string `xml:",chardata"`
			} `xml:"category"`
			PubDate string `xml:"pubDate"`
			Size    string `xml:"size"`
		} `xml:"item"`
	} `xml:"channel"`
}

// TestIndexerConnection tests the connection to an indexer
func (s *IndexerService) TestIndexerConnection(indexer Indexer) TestResult {
    start := time.Now()

    // Validate URL
    if _, err := url.Parse(indexer.URL); err != nil {
        return TestResult{ Status: "failed", Message: "Invalid URL format: " + err.Error(), ResponseTime: 0 }
    }

    return s.testTorznabConnection(indexer, start)
}

// testTorznabConnection tests a Torznab indexer
func (s *IndexerService) testTorznabConnection(indexer Indexer, start time.Time) TestResult {
	testURL := s.buildTorznabURL(indexer, "caps")
	
	req, err := http.NewRequest("GET", testURL, nil)
	if err != nil {
		return TestResult{
			Status:       "failed",
			Message:      "Failed to create request: " + err.Error(),
			ResponseTime: int(time.Since(start).Milliseconds()),
		}
	}

	// Add authentication if provided
	if indexer.APIKey != "" {
		req.Header.Set("X-API-Key", indexer.APIKey)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return TestResult{
			Status:       "failed",
			Message:      "Connection failed: " + err.Error(),
			ResponseTime: int(time.Since(start).Milliseconds()),
		}
	}
	defer resp.Body.Close()

	responseTime := int(time.Since(start).Milliseconds())

    if resp.StatusCode == http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        content := strings.ToLower(string(body))
        if strings.Contains(content, "<error") || strings.Contains(content, "unauthorized") || strings.Contains(content, "invalid api") || strings.Contains(content, "apikey") {
            return TestResult{ Status: "failed", Message: "Authentication failed - check API key", ResponseTime: responseTime }
        }
        return TestResult{ Status: "success", Message: "Connection successful", ResponseTime: responseTime }
	} else if resp.StatusCode == http.StatusUnauthorized {
		return TestResult{
			Status:       "failed",
			Message:      "Authentication failed - check API key",
			ResponseTime: responseTime,
		}
	} else {
		return TestResult{
			Status:       "failed",
			Message:      fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status),
			ResponseTime: responseTime,
		}
	}
}

// testJackettConnection tests a Jackett indexer
func (s *IndexerService) testJackettConnection(indexer Indexer, start time.Time) TestResult {
	testURL := strings.TrimSuffix(indexer.URL, "/") + "/api/v2.0/indexers"
	
	req, err := http.NewRequest("GET", testURL, nil)
	if err != nil {
		return TestResult{
			Status:       "failed",
			Message:      "Failed to create request: " + err.Error(),
			ResponseTime: int(time.Since(start).Milliseconds()),
		}
	}

	// Add API key as query parameter
	if indexer.APIKey != "" {
		q := req.URL.Query()
		q.Add("apikey", indexer.APIKey)
		req.URL.RawQuery = q.Encode()
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return TestResult{
			Status:       "failed",
			Message:      "Connection failed: " + err.Error(),
			ResponseTime: int(time.Since(start).Milliseconds()),
		}
	}
	defer resp.Body.Close()

	responseTime := int(time.Since(start).Milliseconds())

    if resp.StatusCode == http.StatusOK {
        var data interface{}
        if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
            return TestResult{ Status: "failed", Message: "Unexpected response from Jackett", ResponseTime: responseTime }
        }
        if m, ok := data.(map[string]interface{}); ok {
            if _, hasErr := m["Error"]; hasErr { return TestResult{ Status: "failed", Message: "Authentication failed - check API key", ResponseTime: responseTime } }
            if msg, hasMsg := m["Message"]; hasMsg {
                msgStr := strings.ToLower(fmt.Sprint(msg))
                if strings.Contains(msgStr, "unauthor") || strings.Contains(msgStr, "apikey") {
                    return TestResult{ Status: "failed", Message: "Authentication failed - check API key", ResponseTime: responseTime }
                }
            }
        }
        return TestResult{ Status: "success", Message: "Connection successful", ResponseTime: responseTime }
	} else if resp.StatusCode == http.StatusUnauthorized {
		return TestResult{
			Status:       "failed",
			Message:      "Authentication failed - check API key",
			ResponseTime: responseTime,
		}
	} else {
		return TestResult{
			Status:       "failed",
			Message:      fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status),
			ResponseTime: responseTime,
		}
	}
}

// testProwlarrConnection tests a Prowlarr indexer
func (s *IndexerService) testProwlarrConnection(indexer Indexer, start time.Time) TestResult {
	testURL := strings.TrimSuffix(indexer.URL, "/") + "/api/v1/indexer"
	
	req, err := http.NewRequest("GET", testURL, nil)
	if err != nil {
		return TestResult{
			Status:       "failed",
			Message:      "Failed to create request: " + err.Error(),
			ResponseTime: int(time.Since(start).Milliseconds()),
		}
	}

	// Add API key as header
	if indexer.APIKey != "" {
		req.Header.Set("X-Api-Key", indexer.APIKey)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return TestResult{
			Status:       "failed",
			Message:      "Connection failed: " + err.Error(),
			ResponseTime: int(time.Since(start).Milliseconds()),
		}
	}
	defer resp.Body.Close()

	responseTime := int(time.Since(start).Milliseconds())

    if resp.StatusCode == http.StatusOK {
        var data interface{}
        if err := json.NewDecoder(resp.Body).Decode(&data); err == nil {
            if m, ok := data.(map[string]interface{}); ok {
                if errVal, hasErr := m["error"]; hasErr && errVal != nil {
                    return TestResult{ Status: "failed", Message: "Authentication failed - check API key", ResponseTime: responseTime }
                }
            }
        }
        return TestResult{ Status: "success", Message: "Connection successful", ResponseTime: responseTime }
	} else if resp.StatusCode == http.StatusUnauthorized {
		return TestResult{
			Status:       "failed",
			Message:      "Authentication failed - check API key",
			ResponseTime: responseTime,
		}
	} else {
		return TestResult{
			Status:       "failed",
			Message:      fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status),
			ResponseTime: responseTime,
		}
	}
}

// SearchIndexer performs a search on an indexer
func (s *IndexerService) SearchIndexer(indexer Indexer, query string, categories []int, limit int) ([]SearchResult, error) {
    return nil, fmt.Errorf("indexer search is disabled")
}

// searchTorznab performs a search on a Torznab indexer
func (s *IndexerService) searchTorznab(indexer Indexer, query string, categories []int, limit int) ([]SearchResult, error) {
	searchURL := s.buildTorznabURL(indexer, "search")
	
	// Add search parameters
	params := url.Values{}
	params.Add("q", query)
	params.Add("limit", strconv.Itoa(limit))
	
	// Add categories if specified
	if len(categories) > 0 {
		categoryStrs := make([]string, len(categories))
		for i, cat := range categories {
			categoryStrs[i] = strconv.Itoa(cat)
		}
		params.Add("cat", strings.Join(categoryStrs, ","))
	}
	
	searchURL += "&" + params.Encode()

	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Add authentication if provided
	if indexer.APIKey != "" {
		req.Header.Set("X-API-Key", indexer.APIKey)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search failed with status %d: %s", resp.StatusCode, resp.Status)
	}

	// Parse XML response
	_, err = io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// For now, return empty results
	logger.Info("Torznab search response received for query: %s", query)
	
	return []SearchResult{}, nil
}

// searchJackett performs a search on a Jackett indexer
func (s *IndexerService) searchJackett(indexer Indexer, query string, categories []int, limit int) ([]SearchResult, error) {
	searchURL := strings.TrimSuffix(indexer.URL, "/") + "/api/v2.0/indexers/all/results"
	
	params := url.Values{}
	params.Add("Query", query)
	params.Add("Limit", strconv.Itoa(limit))
	
	if indexer.APIKey != "" {
		params.Add("apikey", indexer.APIKey)
	}
	
	searchURL += "?" + params.Encode()

	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search failed with status %d: %s", resp.StatusCode, resp.Status)
	}

	// Parse JSON response
	var results struct {
		Results []struct {
			Title       string `json:"Title"`
			Size        int64  `json:"Size"`
			Category    string `json:"Category"`
			PublishDate string `json:"PublishDate"`
			Link        string `json:"Link"`
			Magnet      string `json:"MagnetUri"`
			Seeders     int    `json:"Seeders"`
			Leechers    int    `json:"Leechers"`
			Indexer     string `json:"Indexer"`
		} `json:"Results"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	searchResults := make([]SearchResult, len(results.Results))
	for i, result := range results.Results {
		searchResults[i] = SearchResult{
			Title:       result.Title,
			Size:        result.Size,
			Category:    result.Category,
			PublishDate: result.PublishDate,
			Link:        result.Link,
			Magnet:      result.Magnet,
			Seeders:     result.Seeders,
			Leechers:    result.Leechers,
			Indexer:     result.Indexer,
			IndexerID:   indexer.ID,
		}
	}

	return searchResults, nil
}

// searchProwlarr performs a search on a Prowlarr indexer
func (s *IndexerService) searchProwlarr(indexer Indexer, query string, categories []int, limit int) ([]SearchResult, error) {
	searchURL := strings.TrimSuffix(indexer.URL, "/") + "/api/v1/search"
	
	searchParams := map[string]interface{}{
		"query":  query,
		"limit":  limit,
		"offset": 0,
	}
	
	if len(categories) > 0 {
		searchParams["categories"] = categories
	}

	jsonData, err := json.Marshal(searchParams)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal search params: %w", err)
	}

	req, err := http.NewRequest("POST", searchURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if indexer.APIKey != "" {
		req.Header.Set("X-Api-Key", indexer.APIKey)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search failed with status %d: %s", resp.StatusCode, resp.Status)
	}

	// Parse JSON response
	var results struct {
		Results []struct {
			Title       string `json:"title"`
			Size        int64  `json:"size"`
			Category    string `json:"category"`
			PublishDate string `json:"publishDate"`
			Link        string `json:"link"`
			Magnet      string `json:"magnet"`
			Seeders     int    `json:"seeders"`
			Leechers    int    `json:"leechers"`
			Indexer     string `json:"indexer"`
		} `json:"results"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	searchResults := make([]SearchResult, len(results.Results))
	for i, result := range results.Results {
		searchResults[i] = SearchResult{
			Title:       result.Title,
			Size:        result.Size,
			Category:    result.Category,
			PublishDate: result.PublishDate,
			Link:        result.Link,
			Magnet:      result.Magnet,
			Seeders:     result.Seeders,
			Leechers:    result.Leechers,
			Indexer:     result.Indexer,
			IndexerID:   indexer.ID,
		}
	}

	return searchResults, nil
}

// buildTorznabURL builds a Torznab API URL
func (s *IndexerService) buildTorznabURL(indexer Indexer, action string) string {
	baseURL := strings.TrimSuffix(indexer.URL, "/")
	if !strings.HasSuffix(baseURL, "/api") {
		baseURL += "/api"
	}
	
	params := url.Values{}
	params.Add("t", action)
	
	if indexer.APIKey != "" {
		params.Add("apikey", indexer.APIKey)
	}
	
	return baseURL + "?" + params.Encode()
}

// Global indexer service instance
var indexerService = NewIndexerService()

// TestIndexerConnection is a convenience function for testing indexer connections
func TestIndexerConnection(indexer Indexer) TestResult {
	return indexerService.TestIndexerConnection(indexer)
}

// SearchIndexer is a convenience function for searching indexers
func SearchIndexer(indexer Indexer, query string, categories []int, limit int) ([]SearchResult, error) {
	return indexerService.SearchIndexer(indexer, query, categories, limit)
}
