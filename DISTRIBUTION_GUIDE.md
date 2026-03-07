# OSCAR Distribution Guide

This guide explains how to package the OSCAR application for use on other computers.

## 1. Prerequisites
- **Node.js**: Ensure Node.js (v18+) is installed on the build machine.
- **T24 Dongle Drivers**: Ensure the T24 USB dongle drivers are installed on any computer that will run the app.

## 2. Building the Application
To create the distributable version of OSCAR:

1.  Open a terminal in the project root.
2.  Run the build command:
    ```bash
    npm run electron:build
    ```
3.  The build process will create a `release/` directory.

## 3. How to Distribute (The ZIP Method)
The most reliable way to distribute OSCAR to another computer is to zip up the "unpacked" folder. This ensures all required files (like `ffmpeg.dll`) stay together.

1.  Go to the `release/` folder.
2.  Locate the folder named **`win-unpacked`**.
3.  Right-click the `win-unpacked` folder and select **Compress to ZIP file**.
4.  Rename the resulting ZIP to something like `OSCAR_Dashboard_v1.zip`.

## 4. Setting Up on a New Computer
1.  Copy the ZIP file to the new computer.
2.  **Extract All** files from the ZIP.
3.  Open the extracted folder and run **`OSCAR Dashboard.exe`**.

> [!CAUTION]
> **Don't just copy the .exe file!** The program needs the other files in that same folder (like `ffmpeg.dll`) to run. Always copy/zip the **entire folder**.

## 5. Configuration (Post-Transfer)
1.  **Calibration**: By default, the app uses the `config/calibration.json` file. If you need to update calibration on a specific machine, place a `calibration.json` file in:
    `%AppData%/oscar-dashboard/calibration.json`

2.  **Settings**: Once the app is running on the new machine, go to the **Settings** screen to enter the OpenAI and SharePoint credentials.

## 6. Troubleshooting
- **ffmpeg.dll not found**: This happens if you move the `.exe` out of its folder. Make sure you are running it from within the extracted folder.
- **No Dongle Detected**: Ensure the T24 dongle is plugged in and the drivers are installed.
- **Reset App**: If you need to clear all data, delete the `%AppData%/oscar-dashboard` folder.
