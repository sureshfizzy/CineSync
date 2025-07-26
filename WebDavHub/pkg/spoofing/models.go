package spoofing

import "time"

// SystemStatusResponse represents the system status for both Radarr and Sonarr
type SystemStatusResponse struct {
	Version                string `json:"version"`
	BuildTime              string `json:"buildTime"`
	IsDebug                bool   `json:"isDebug"`
	IsProduction           bool   `json:"isProduction"`
	IsAdmin                bool   `json:"isAdmin"`
	IsUserInteractive      bool   `json:"isUserInteractive"`
	StartupPath            string `json:"startupPath"`
	AppData                string `json:"appData"`
	OsName                 string `json:"osName"`
	OsVersion              string `json:"osVersion"`
	IsMonoRuntime          bool   `json:"isMonoRuntime"`
	IsMono                 bool   `json:"isMono"`
	IsLinux                bool   `json:"isLinux"`
	IsOsx                  bool   `json:"isOsx"`
	IsWindows              bool   `json:"isWindows"`
	Mode                   string `json:"mode"`
	Branch                 string `json:"branch"`
	Authentication         string `json:"authentication"`
	SqliteVersion          string `json:"sqliteVersion"`
	MigrationVersion       int    `json:"migrationVersion"`
	UrlBase                string `json:"urlBase"`
	RuntimeVersion         string `json:"runtimeVersion"`
	RuntimeName            string `json:"runtimeName"`
	StartTime              string `json:"startTime"`
	PackageVersion         string `json:"packageVersion"`
	PackageAuthor          string `json:"packageAuthor"`
	PackageUpdateMechanism string `json:"packageUpdateMechanism"`
}

// FolderMapping represents a folder mapping for spoofing
type FolderMapping struct {
	FolderPath   string `json:"folderPath"`
	DisplayName  string `json:"displayName"`
	ServiceType  string `json:"serviceType"`
	APIKey       string `json:"apiKey"`
	Enabled      bool   `json:"enabled"`
}

// AvailableFolder represents a folder available for mapping
type AvailableFolder struct {
	Path        string `json:"path"`
	DisplayName string `json:"displayName"`
	FileCount   int    `json:"fileCount"`
}

// MovieFile represents a movie file in Radarr
type MovieFile struct {
	ID           int       `json:"id"`
	MovieId      int       `json:"movieId"`
	RelativePath string    `json:"relativePath"`
	Path         string    `json:"path"`
	Size         int64     `json:"size"`
	DateAdded    time.Time `json:"dateAdded"`
	Quality      Quality   `json:"quality"`
	Languages    []Language `json:"languages"`
}

// Quality represents quality information
type Quality struct {
	Quality  QualityDefinition `json:"quality"`
	Revision QualityRevision   `json:"revision"`
}

// QualityDefinition represents a quality definition
type QualityDefinition struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Source     string `json:"source"`
	Resolution int    `json:"resolution"`
}

// QualityRevision represents quality revision info
type QualityRevision struct {
	Version  int  `json:"version"`
	Real     int  `json:"real"`
	IsRepack bool `json:"isRepack"`
}

// Language represents a language
type Language struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// MovieResource represents a Radarr movie
type MovieResource struct {
	ID                  int           `json:"id"`
	Title               string        `json:"title"`
	OriginalTitle       string        `json:"originalTitle"`
	SortTitle           string        `json:"sortTitle"`
	Status              string        `json:"status"`
	Overview            string        `json:"overview"`
	Year                int           `json:"year"`
	HasFile             bool          `json:"hasFile"`
	MovieFileId         int           `json:"movieFileId"`
	Path                string        `json:"path"`
	QualityProfileId    int           `json:"qualityProfileId"`
	Monitored           bool          `json:"monitored"`
	MinimumAvailability string        `json:"minimumAvailability"`
	IsAvailable         bool          `json:"isAvailable"`
	Runtime             int           `json:"runtime"`
	CleanTitle          string        `json:"cleanTitle"`
	ImdbId              string        `json:"imdbId"`
	TmdbId              int           `json:"tmdbId"`
	TitleSlug           string        `json:"titleSlug"`
	RootFolderPath      string        `json:"rootFolderPath"`
	Certification       string        `json:"certification"`
	Genres              []string      `json:"genres"`
	Tags                []int         `json:"tags"`
	Added               time.Time     `json:"added"`
	Images              []interface{} `json:"images"`
	Popularity          float64       `json:"popularity"`
	MovieFile           *MovieFile    `json:"movieFile,omitempty"`
	SizeOnDisk          int64         `json:"sizeOnDisk"`
}

// SeriesResource represents a Sonarr TV series
type SeriesResource struct {
	ID                int           `json:"id"`
	Title             string        `json:"title"`
	AlternateTitles   []interface{} `json:"alternateTitles"`
	SortTitle         string        `json:"sortTitle"`
	Status            string        `json:"status"`
	Overview          string        `json:"overview"`
	Network           string        `json:"network"`
	AirTime           string        `json:"airTime"`
	Images            []interface{} `json:"images"`
	Seasons           []interface{} `json:"seasons"`
	Year              int           `json:"year"`
	Path              string        `json:"path"`
	QualityProfileId  int           `json:"qualityProfileId"`
	LanguageProfileId int           `json:"languageProfileId"`
	SeasonFolder      bool          `json:"seasonFolder"`
	Monitored         bool          `json:"monitored"`
	Runtime           int           `json:"runtime"`
	TvdbId            int           `json:"tvdbId"`
	TvRageId          int           `json:"tvRageId"`
	TvMazeId          int           `json:"tvMazeId"`
	FirstAired        string        `json:"firstAired"`
	LastInfoSync      time.Time     `json:"lastInfoSync"`
	SeriesType        string        `json:"seriesType"`
	CleanTitle        string        `json:"cleanTitle"`
	TitleSlug         string        `json:"titleSlug"`
	RootFolderPath    string        `json:"rootFolderPath"`
	Genres            []string      `json:"genres"`
	Tags              []int         `json:"tags"`
	Added             time.Time     `json:"added"`
}

// QualityProfile represents a quality profile
type QualityProfile struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// LanguageProfile represents a language profile (Sonarr only)
type LanguageProfile struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// RootFolder represents a root folder
type RootFolder struct {
	ID   int    `json:"id"`
	Path string `json:"path"`
}

// Tag represents a tag
type Tag struct {
	ID    int    `json:"id"`
	Label string `json:"label"`
}

// HealthCheck represents a health check result
type HealthCheck struct {
	Source  string `json:"source"`
	Type    string `json:"type"`
	Message string `json:"message"`
	WikiUrl string `json:"wikiUrl"`
}
