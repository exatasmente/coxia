# Release Note

Secrets and file paths are now provided by the host via ports, removing the need for direct Electron imports. Desktop users experience no change: secrets remain in the same file with the same permissions, and folders stay where they were. Headless hosts can now run this part of the app by providing a master key file and setting the data folders.
