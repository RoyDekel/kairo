---
name: Release Stuck Server
description: Finds and kills a stuck Node.js server process occupying port 3001, then optionally restarts it. Use this whenever the dev server is unresponsive or a port conflict prevents starting the server.
---

# Release Stuck Server

This skill handles the common scenario where the Node.js dev server on **port 3001** becomes stuck or unresponsive.

## Steps

1. **Identify the process** holding port 3001:
   ```powershell
   netstat -ano | findstr :3001
   ```
   Look for a line with `LISTENING` — the last column is the **PID**.

2. **Kill the process** using the PID from step 1:
   ```powershell
   taskkill /PID <PID> /F
   ```

3. **Verify the port is free**:
   ```powershell
   netstat -ano | findstr :3001
   ```
   This should return no results.

4. **Restart the server**:
   ```powershell
   npm run dev
   ```
   Run from the project root: `c:\Users\royda\.gemini\antigravity\scratch\kairo`

## Notes
- Always use `/F` (force) flag with `taskkill` since the process is stuck.
- If multiple PIDs are found on the port, kill all of them.
- If no process is found on port 3001, inform the user that the port is already free.
