# VEYRA — Personal AI Robot

A React robot face with voice input, spoken replies, expressions, and an Express/OpenAI backend.

## Requirements
- Node.js 20 or newer
- An OpenAI API key (API usage is billed separately from ChatGPT)
- Chrome recommended for Android tablet speech recognition

## Install
```powershell
npm install
```

Copy `.env.example` to `.env` and add your API key:
```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.5
PORT=5000
```

## Run during development
```powershell
npm run dev
```
Open the Vite address shown in the terminal on your computer.

## Run on the Lenovo tablet
Microphone access requires a secure context. The easiest route is to build the app and expose the Express server through an HTTPS tunnel.

Terminal 1:
```powershell
npm run build
npm start
```
Terminal 2 (install ngrok separately, then authenticate it once):
```powershell
ngrok http 5000
```
Open the **HTTPS forwarding address** shown by ngrok in Chrome on the tablet. Allow microphone access. Keep the computer and server running.

If you change the code, rebuild with `npm run build` and restart the server.

## Notes
- Speech recognition support varies by browser and Android version. Chrome is recommended.
- If voice recognition is unavailable, use the text box.
- Never put the API key in frontend code or commit `.env` to Git.
- This starter uses browser text-to-speech; the available voice depends on Android's installed speech engines.
- The tablet and computer do not need to be on the same Wi-Fi when using an HTTPS tunnel.
