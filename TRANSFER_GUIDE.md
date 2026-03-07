# How to Transfer and Work on This Project

This guide provides step-by-step instructions for moving the `log100-dashboard` project to a new computer.

## Option 1: Manual Transfer (USB or Cloud Drive)

This is the simplest method if you don't want to use Git/GitHub.

### 1. Prepare the Project (on the Old Computer)
You should **not** copy the `node_modules` folder, as it is very large and contains computer-specific files.

1.  Open the project folder: `c:\Users\green\.gemini\antigravity\scratch\log100-dashboard`
2.  Select all files **EXCEPT** the `node_modules` folder.
3.  Right-click and select **Compress to ZIP file**.
4.  Copy this ZIP file to your USB drive or upload it to a cloud service (e.g., Google Drive, OneDrive).

### 2. Set Up the New Computer
Before you can run the project, the new computer needs a environment set up:

1.  **Install Node.js**: Download and install the LTS version from [nodejs.org](https://nodejs.org/).
2.  **Extract the Project**: Move the ZIP file to the new computer and extract it to a folder (e.g., `C:\Projects\log100-dashboard`).

### 3. Reinstall Dependencies
1.  Open a terminal (PowerShell or Command Prompt) in the project folder.
2.  Run the following command to download the necessary libraries:
    ```bash
    npm install
    ```

### 4. Run the Project
Once dependencies are installed, you can start the project just like before:
```bash
npm run dev
```

---

## Option 2: Professional Workflow (GitHub)

If you plan to move between computers often, using GitHub is highly recommended.

1.  **Create a Repository**: Create a private repository on [GitHub](https://github.com).
2.  **Push the Code**: Upload your project (excluding `node_modules`).
3.  **Clone on New Computer**: On the new computer, use `git clone <repository-url>` to download the project.
4.  **Sync Changes**: You can then use `git add`, `git commit`, and `git push` to save your work, and `git pull` on the other computer to get the latest changes.

> [!NOTE]
> Don't forget to copy your `.env` file! It often contains private settings and is usually excluded from Git for security.
