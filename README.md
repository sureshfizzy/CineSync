![Github](https://github.com/user-attachments/assets/1d61e450-b5df-4a7d-960c-a4d77770c933)

<p align="center">
  <a href="https://discord.gg/BtZYTCQtAR">
    <img src="https://img.shields.io/badge/discord-cinesync-5865F2?logo=discord&logoColor=white" alt="Discord">
  </a>
  <a href="https://github.com/sureshfizzy/CineSync/releases/latest">
    <img src="https://img.shields.io/github/downloads/sureshfizzy/CineSync/total.svg?maxAge=60&style=flat-square" alt="GitHub Releases">
  </a>
  <a href="https://hub.docker.com/r/sureshfizzy/cinesync">
    <img src="https://img.shields.io/docker/pulls/sureshfizzy/cinesync.svg?maxAge=60&style=flat-square" alt="Docker Pulls">
  </a>
</p>


# CineSync - Organize Your Debrid Library Easily

CineSync is a Python-based library management system designed to efficiently organize debrid libraries for Movies & TV shows, eliminating the need for Sonarr/Radarr. Users downloading from DMM Manager can seamlessly sort their library into seasons, whether it's a single file or a folder. CineSync streamlines the organization of your library and creates symbolic links, providing full control over your data locally. While highly optimized for debrid platforms, CineSync is also versatile and works effectively with non-debrid platforms.

# General Info

CineSync works by creating symbolic links from the source directory to the destination directory and organizing them according to the user's preferences. This allows users to maintain a well-structured library without physically moving or duplicating the original files.

## Getting Started

For detailed instructions on installation, configuration, and usage, please visit our Wiki:

- [Getting Started](https://github.com/sureshfizzy/CineSync/wiki)
- [Installation Guide](https://github.com/sureshfizzy/CineSync/wiki/Installation)
- [Configuration Options](https://github.com/sureshfizzy/CineSync/wiki/Configuration)
- [Usage Guide](https://github.com/sureshfizzy/CineSync/wiki/Usage)
- [Docker Volumes](https://github.com/sureshfizzy/CineSync/wiki/Volumes)

## Docker Hub Repository

The CineSync Docker image is available on Docker Hub:

- [CineSync Docker Image](https://hub.docker.com/r/sureshfizzy/cinesync)

## Supported Architectures

- `amd64` (x86_64)
- `arm64` (aarch64)

## Features

- **Library Organization:** Easily sort your library into seasons, regardless of file or folder structure.
- **Faster Scan:** CineSync has been optimized for faster file and directory scanning. Improved directory checks, file handling, and multi-threaded processing (controlled by `MAX_PROCESSES`) help speed up the scan process, especially for large libraries.
- **Symbolic Link Creation:** Create symbolic links to organize your library without moving or duplicating files.
- **Real-Time Monitoring for Files:** Monitor the watch directory for any new files and automatically create symbolic links for them, ensuring your library stays updated in real-time. (Configurable monitoring interval via `SLEEP_TIME`).
- **Support for Single Symlinks Creation:** CineSync now supports creating symbolic links for single files or folders, providing flexibility in managing your library.
- **Ability to Skip Already Present Symlinks:** CineSync includes the ability to skip the creation of symbolic links for files or folders that are already present, even if the folder name is different. This feature ensures efficient management of your library by preventing duplicate symlinks.
- **Rename Files:** Properly rename your files based on TMDb data when `RENAME_ENABLED=true`.
- **Cross-Platform Support:** Works on both Linux and Windows operating systems.
- **Movie Collection-Based Separation:** Organize movies into collections based on TMDb or IMDb data, ensuring that all movies from the same collection are grouped together. (Enabled via `MOVIE_COLLECTION_ENABLED`).
- **Docker Support:** Easily deploy CineSync in a Docker container for consistent and isolated environments.
- **TMDb/IMDB/TVDB ID Integration:** Utilize TMDb/IMDB/TVDB IDs for more precise organization and naming of your media files.
- **Automatic Separation of Extras and Resolutions:** Automatically separate extras from main episodes and sort files based on resolution (e.g., 720p, 1080p, 4K), ensuring a well-organized library. (Configurable via `SKIP_EXTRAS_FOLDER`).
- **Resolution-Based File Sorting:** Separate files based on resolution (e.g., 720p, 1080p, 4K) for easier organization. If resolution-based separation is not enabled, files will be organized based on the source folder structure.
- **Database Configuration:** Optimized for efficient database operations with configurable throttle rates, retry mechanisms, and batch processing to manage media metadata and symlink creation. (Controlled via `DB_*` variables).
- **Rclone Mount Verification:** CineSync supports checking if rclone mount points are available before processing files. This feature is useful for managing remote storage and ensures the mount is active before symlink creation. (Enabled via `RCLONE_MOUNT`).

## Real-Time Monitoring

CineSync now includes a fully integrated real-time monitoring feature that automatically tracks changes in your media library. This functionality is particularly useful for handling series or shows that are regularly downloaded, ensuring that your library stays up-to-date without manual intervention.

### How it works:

- **Initial Full Scan:** Upon starting, CineSync will first perform a full scan of your library to organize and identify all existing files and folders.

- **Automatic Trigger:** Once the full scan is completed, the real-time monitoring will automatically trigger, and from that point on, CineSync will continuously monitor your designated watch directory for new files or folders.

- **Watch Directory:** CineSync continuously monitors the watch directory where new files or folders are expected to be added.

- **Monitoring Interval:** By default, CineSync checks the watch directory every 60 seconds for any changes. You can modify this interval by adjusting the `SLEEP_TIME` variable in the configuration file.

- **Automatic Identification:** When a new file or folder is detected, CineSync automatically identifies it based on its naming conventions and other factors.

- **Symbolic Link Creation:** Once identified, CineSync creates symbolic links for the newly added file or folder. This ensures that your library remains organized without physically moving or duplicating files, preserving disk space.

- **Efficiency:** Real-time monitoring allows users to stay up-to-date with library changes automatically. It streamlines the process of handling daily series or shows by organizing new additions without requiring manual input.

- **Customization:** You can easily customize the monitoring interval and other settings to better suit your specific needs and library requirements.

CineSync’s real-time monitoring is now a core feature of the script and Docker images, allowing for seamless integration into your workflow. With this feature, users can effortlessly manage their media library and maintain a well-organized collection of files.

## Contributors

- [Suresh S](https://github.com/sureshfizzy)❤️
- Special thanks to [Paolo](https://github.com/RunAway189) for testing the application.!
- [Buy Me a Coffee](https://www.buymeacoffee.com/Sureshfizzy)☕
