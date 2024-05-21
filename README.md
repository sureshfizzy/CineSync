# CineSync - Organize Your Debrid Library Easily

CineSync is a Python & Bash based library management system designed to facilitate the organization of debrid libraries for Shows efficiently, without the need for Sonarr. Users downloading from DMM Manager can easily sort their library into seasons, whether it's a single file or a folder. CineSync smoothly organizes the library and creates symbolic links, giving users full control over their data locally.

This project works with the support of [Zurg](https://github.com/debridmediamanager/zurg-testing). Special thanks to [yowmamasita](https://github.com/yowmamasita). This project might also work with Plex-Debrid (haven't tested that yet, any volunteers are welcome).

# General Info

CineSync works by creating symbolic links from the source directory to the destination directory and organizing them according to the user's preferences. This allows users to maintain a well-structured library without physically moving or duplicating the original files.

## Features

- **Library Organization:** Easily sort your library into seasons, regardless of file or folder structure.
- **Symbolic Link Creation:** Create symbolic links to organize your library without moving or duplicating files.
- **Real-Time Monitoring for Files:** Monitor the watch directory for any new files and automatically create symbolic links for them, ensuring your library stays updated in real-time.
- **Support for Single Symlinks Creation:** CineSync now supports creating symbolic links for single files or folders, providing flexibility in managing your library.
- **Ability to Skip Already Present Symlinks:** CineSync includes the ability to skip the creation of symbolic links for files or folders that are already present, even if the folder name is different. This feature ensures efficient management of your library by preventing duplicate symlinks.
- **Cross-Platform Support:** Works on both Linux and Windows operating systems.

## Real-Time Monitoring

CineSync offers a powerful real-time monitoring feature that allows users to keep track of changes in their library automatically. This feature is particularly useful for handling daily series or shows that are regularly downloaded. Here's how it works:

![Real-Time Monitoring](Screenshots/Real_Time_Monitoring.png)

- **Watch Directory:** CineSync continuously monitors a designated watch directory where new files or folders are expected to be added.

- **Default Monitoring Interval:** By default, CineSync checks the watch directory every 60 seconds for any changes. You can Increase/Decrease the time limit inside RealTime-Monitoring.py

- **Automatic Identification:** When a new file or folder is detected in the watch directory, CineSync automatically identifies it.

- **Symbolic Link Creation:** After identification, CineSync creates symbolic links for the newly added file or folder. These symbolic links ensure that the organization of the library remains intact without physically moving or duplicating the files.

- **Efficiency:** Real-time monitoring ensures that users stay up-to-date with their library changes without manual intervention. It streamlines the process of handling daily series or shows by automatically organizing new additions.

- **Customization:** Users have the flexibility to customize the monitoring interval according to their preferences or specific requirements.

By leveraging real-time monitoring in CineSync, users can effortlessly manage their library and maintain a well-organized collection of media files.


## Getting Started

## Requirements

- Python 3.x
- For Windows: Git Bash with symbolic links enabled
- [Zurg](https://github.com/debridmediamanager/zurg-testing)

### For Linux:

Here's an enhanced version of the instructions:

1. **Clone the Repository:** Clone the CineSync repository from GitHub and navigate to the cloned directory:
   ```
   git clone https://github.com/sureshfizzy/CineSync.git && cd CineSync
   ```

2. **Install the Requirements:** Install the required dependencies for CineSync:
   ```
   pip install -r requirements.txt
   ```

3. **Update Paths in `library.sh`:** Open the `library.sh` file located inside the `Scripts` folder. Update the following paths:
   - `show_source_dir`: Specify the path for the Zurg-mounted shows directory.
   - `destination_dir`: Set the ultimate destination directory where you want to save the symbolic links.

4. **Update Paths in `RealTime-Monitor.py`:** Open the `RealTime-Monitor.py` file and update the following paths:
   - `watch_dir`: Set the path for the Zurg shows directory (same path which you mentioned for `show_source_dir` in `library.sh`).
   - `bash_script`: Specify the path for the `library.sh` script.

   Note: Ensure that the paths are correctly updated to reflect your system's configuration.

5. **Execute CineSync:** After updating the paths, execute the main script:
   ```
   bash CineSync.sh
   ```

   This will launch the CineSync interface, allowing you to perform various library management tasks, including full library scans, real-time monitoring, and more.

By following these steps and updating the necessary paths, you'll be able to successfully use CineSync to manage your debrid library.

### For Windows:

1. **Install Python:**
   Install Python from the official website: [Python.org](https://www.python.org/). Make sure to add Python to your system PATH during installation.

2. **Install Git Bash:**
   Install Git Bash from [Git for Windows](https://gitforwindows.org/). During installation, enable the symbolic links checkbox.

![Git Bash](Screenshots/git_bash.png)

   Enabling symbolic links is important for certain operations, so ensure that the checkbox for symbolic links is checked during installation.

3. **Edit `.bashrc` (Windows):**
   Open Git Bash as an administrator and edit the `.bashrc` file. You can use the `nano` editor to open the file by running the following command:
   ```
   nano /etc/bash.bashrc
   ```
   Add the following line at the bottom of the file:
   ```
   export MSYS=winsymlinks:nativestrict
   ```
   Save the changes by pressing `Ctrl + O`, then press `Enter` to confirm. Exit the editor by pressing `Ctrl + X`.

   **Important:** Ensure that the `export MSYS=winsymlinks:nativestrict` line is added to the `.bashrc` file. This configuration is essential to ensure that symbolic links are handled correctly on Windows when using Git Bash. Without this setting, CineSync may copy files instead of creating symbolic links, leading to undesired behavior.

4. **Enable Windows Developer Mode:**

	Enabling Developer Mode grants your system additional privileges necessary for certain operations, helping to prevent permission-related errors during development.

	To avoid "Operation not permitted" errors during symlink process, it's essential to enable Windows Developer Mode. Follow these steps:

	- Open **Settings**.
	- Go to **Update & Security**.
	- Click on **For developers**.
	- Enable the **Developer mode** option.
	- Restart the PC

	![Developer Mode](Screenshots/Developer_Mode.png)

5. **Clone the Repository:**
   ```
   git clone https://github.com/sureshfizzy/CineSync.git
   ```

6. **Update Paths in `library.sh`:** Open the `library.sh` file located inside the `Scripts` folder. Update the following paths:
   - `show_source_dir`: Specify the path for the Zurg-mounted shows directory.
   - `destination_dir`: Set the ultimate destination directory where you want to save the symbolic links.

7. **Update Paths in `RealTime-Monitor.py`:** Open the `RealTime-Monitor.py` file and update the following paths:
   - `watch_dir`: Set the path for the Zurg shows directory (same path which you mentioned for `show_source_dir` in `library.sh`).
   - `bash_script`: Specify the path for the `library.sh` script.

   Note: Ensure that the paths are correctly updated to reflect your system's configuration.

8. **Run the Script:**
   ```
   bash CineSync.sh
   ```
**Real-Time Monitoring Windows Limitation**

Due to current limitations, Real-Time Monitoring cannot run as a system service on Windows. However, you can run the `RealTime-Monitor.py` file separately if needed by triggering it in a Bash script. 

**Note:** Ensure to execute the `RealTime-Monitor.py` file within the Git Bash environment to ensure proper functionality.

This emphasizes the Windows limitation and provides a workaround for users who may still want to utilize real-time monitoring on Windows.

Here's the revised "Usage" section with the provided details:

## Usage

CineSync provides a user-friendly interface for managing your debrid library. Upon running the script, you'll be presented with a main menu where you can choose from various options:

![Main Menu](Screenshots/main_menu.png)

- **1) Full Library Scan:** Perform a comprehensive scan of your entire library.

<div style="display: flex; justify-content: space-between;">
  <img src="Screenshots/Full_Library_Scan.png" alt="Full_Scan" width="400"/>
  <img src="Screenshots/Full_Scan_OP.png" alt="Full_ScanOP" width="400"/>
  <img src="Screenshots/Full_Scan_OP2.png" alt="Full_ScanOP2" width="400"/>
  <img src="Screenshots/Full_Scan_OP3.png" alt="Full_ScanOP3" width="400"/>
</div>

- **2) Real-Time Monitoring (Linux Only):** Enable real-time monitoring to stay updated on library changes. System services are automatically created, and the scan is triggered every 60 seconds. You can adjust the frequency inside `RealTime-Monitor.py`.
- **3) Remove Broken Symlinks :** Identify and remove broken symbolic links within your library.
- **4) Exit:** Quit the CineSync application.

**Note:** Real-Time Monitoring is currently supported only on Linux due to system service limitations on Windows. However, you can still manually trigger real-time monitoring using the provided instructions in the README.

## Single File/Folder Symlink Creation

CineSync also supports the creation of single file or folder symlinks. Follow these steps to create a symlink for a single file or folder:

1. **Navigate to Scripts Folder:**
   - Open your terminal or command prompt and navigate to the Scripts folder of the CineSync repository.

2. **Enter Series Name and Full Path:**
   - Inside the Scripts folder, run the following command:
     ```bash
     bash ./library.sh "/mnt/Real-Debrid/remote/rclone/Shows/13.Reasons.Why.S03.1080p.WEBRip.x265-RARBG/13.Reasons.Why.S03E09.1080p.WEBRip.x265-RARBG.mp4"
     ```
     Replace `"/mnt/Real-Debrid/remote/rclone/Shows/13.Reasons.Why.S03.1080p.WEBRip.x265-RARBG/13.Reasons.Why.S03E09.1080p.WEBRip.x265-RARBG.mp4"` with the full path to the file or folder you want to create a symlink for.

3. **Execute Command:**
   - Press Enter to execute the command.

<div style="display: flex; justify-content: space-between;">
  <img src="Screenshots/Single_File.png" alt="Single_File" width="400"/>
  <img src="Screenshots/Single_FileOP.png" alt="Single_FileOP" width="400"/>
</div>

By following these steps, you can easily create a symlink for a single file or folder using CineSync.

## Contributors

- [Suresh S](https://github.com/sureshfizzy)❤️
- [Buy Me a Coffee](https://www.buymeacoffee.com/Sureshfizzy)☕
