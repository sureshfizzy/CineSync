package prowlarr

import (
    "fmt"
    "net/http"
    "net/url"
    "strings"
    "time"
)

// Minimal Torznab Caps
func HandleTorznabCaps(w http.ResponseWriter, r *http.Request) {
    pathParts := strings.Split(r.URL.Path, "/")
    indexerSlug := "unknown"
    if len(pathParts) >= 3 { indexerSlug = pathParts[2] }

    capsXML := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
        "<caps>\n" +
        "  <server version=\"1.0\" title=\"CineSync Prowlarr\"/>\n" +
        "  <limits max=\"100\" default=\"100\"/>\n" +
        "  <searching>\n" +
        "    <search available=\"yes\" supportedParams=\"q\"/>\n" +
        "    <tv-search available=\"yes\" supportedParams=\"q,season,ep\"/>\n" +
        "    <movie-search available=\"yes\" supportedParams=\"q,imdbid,tmdbid\"/>\n" +
        "  </searching>\n" +
        "  <categories>\n" +
        "    <category id=\"2000\" name=\"Movies\">\n" +
        "      <subcat id=\"2040\" name=\"HD\"/>\n" +
        "    </category>\n" +
        "    <category id=\"5000\" name=\"TV\">\n" +
        "      <subcat id=\"5040\" name=\"HD\"/>\n" +
        "    </category>\n" +
        "  </categories>\n" +
        "</caps>"

    w.Header().Set("Content-Type", "application/xml")
    w.Write([]byte(capsXML))
    _ = indexerSlug
}

// Minimal Torznab Search
func HandleTorznabSearch(w http.ResponseWriter, r *http.Request) {
    query := r.URL.Query().Get("q")
    categories := r.URL.Query().Get("cat")
    pathParts := strings.Split(r.URL.Path, "/")
    indexerSlug := "unknown"
    if len(pathParts) >= 3 { indexerSlug = pathParts[2] }

    // Build items
    itemsXML := ""
    safeTitle := query
    if safeTitle == "" { safeTitle = "Results" }
    catId := "2000"
    if strings.Contains(strings.ToLower(categories), "5000") { catId = "5000" }
    if query != "" {
        now := time.Now().Format(time.RFC1123Z)
        guid1 := fmt.Sprintf("cinesync-%s-%d", strings.ReplaceAll(query, " ", "-"), time.Now().Unix())
        magnet1 := fmt.Sprintf("magnet:?xt=urn:btih:%x&dn=%s", time.Now().UnixNano(), url.QueryEscape(query+".1080p"))
        itemsXML += "  <item>\n"
        itemsXML += "    <title>" + xmlEscape(safeTitle+" 1080p") + "</title>\n"
        itemsXML += "    <guid isPermaLink=\"false\">" + xmlEscape(guid1) + "</guid>\n"
        itemsXML += "    <pubDate>" + now + "</pubDate>\n"
        itemsXML += "    <link>" + xmlEscape(magnet1) + "</link>\n"
        itemsXML += "    <category>" + catId + "</category>\n"
        itemsXML += "    <torznab:attr name=\"category\" value=\"" + catId + "\"/>\n"
        itemsXML += "  </item>\n"

        guid2 := guid1 + "-2"
        magnet2 := fmt.Sprintf("magnet:?xt=urn:btih:%x&dn=%s", time.Now().UnixNano()+1, url.QueryEscape(query+".720p"))
        itemsXML += "  <item>\n"
        itemsXML += "    <title>" + xmlEscape(safeTitle+" 720p") + "</title>\n"
        itemsXML += "    <guid isPermaLink=\"false\">" + xmlEscape(guid2) + "</guid>\n"
        itemsXML += "    <pubDate>" + now + "</pubDate>\n"
        itemsXML += "    <link>" + xmlEscape(magnet2) + "</link>\n"
        itemsXML += "    <category>" + catId + "</category>\n"
        itemsXML += "    <torznab:attr name=\"category\" value=\"" + catId + "\"/>\n"
        itemsXML += "  </item>\n"
    }

    rssHeader := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
        "<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:torznab=\"http://torznab.com/schemas/2015/feed\">\n" +
        "  <channel>\n" +
        "    <atom:link href=\"http://localhost:8082/torznab/" + indexerSlug + "/api\" rel=\"self\" type=\"application/rss+xml\"/>\n" +
        "    <title>CineSync Prowlarr</title>\n" +
        "    <description>A usenet and torrent meta indexer</description>\n" +
        "    <language>en-us</language>\n" +
        "    <category>search</category>\n"
    rssFooter := "  </channel>\n</rss>"

    w.Header().Set("Content-Type", "application/xml")
    w.Write([]byte(rssHeader + itemsXML + rssFooter))
}

// xmlEscape escapes minimal XML chars
func xmlEscape(s string) string {
    r := strings.ReplaceAll(s, "&", "&amp;")
    r = strings.ReplaceAll(r, "<", "&lt;")
    r = strings.ReplaceAll(r, ">", "&gt;")
    r = strings.ReplaceAll(r, "\"", "&quot;")
    r = strings.ReplaceAll(r, "'", "&apos;")
    return r
}