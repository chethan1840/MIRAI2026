import { useEffect, useRef, useState } from "react";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function App() {
  const [status, setStatus] = useState("idle");
  const [expression, setExpression] = useState("neutral");
  const recognitionRef = useRef(null);   // main recognition (listen → chat)
  const stopWatchRef = useRef(null);     // parallel watcher that only listens for "stop"
  const listeningRef = useRef(false);

  // ── Parallel "stop" watcher — runs while VEYRA is speaking ──
  function startStopWatcher() {
    if (!SpeechRecognition) return;
    stopStopWatcher(); // ensure clean slate

    const rec = new SpeechRecognition();
    rec.lang = "en-IN";
    rec.continuous = true;        // keep listening the whole time
    rec.interimResults = true;    // react as soon as word is detected
    rec.maxAlternatives = 1;

    rec.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const word = event.results[i][0].transcript.trim().toLowerCase();
        if (/\bstop\b/.test(word)) {
          window.speechSynthesis.cancel();
          stopStopWatcher();
          setStatus("idle");
          setExpression("neutral");
          setTimeout(() => startListening(), 600);
          return;
        }
      }
    };

    rec.onerror = () => {};  // silently ignore — it's a background watcher
    rec.onend = () => {
      // restart watcher if still speaking
      setStatus(cur => {
        if (cur === "speaking") startStopWatcher();
        return cur;
      });
    };

    stopWatchRef.current = rec;
    try { rec.start(); } catch {}
  }

  function stopStopWatcher() {
    try { stopWatchRef.current?.stop(); } catch {}
    stopWatchRef.current = null;
  }

  // ── Main recognition loop ──
  function startListening() {
    if (!SpeechRecognition) return;
    if (listeningRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listeningRef.current = true;
      setStatus("listening");
      setExpression("listening");
    };

    recognition.onresult = event => {
      const heard = event.results[0][0].transcript.trim().toLowerCase();
      listeningRef.current = false;
      sendMessage(heard);
    };

    recognition.onerror = () => {
      listeningRef.current = false;
      setStatus("idle");
      setExpression("neutral");
      setTimeout(() => startListening(), 1200);
    };

    recognition.onend = () => {
      listeningRef.current = false;
      setStatus(cur => {
        if (cur === "listening") {
          setTimeout(() => startListening(), 400);
          return "idle";
        }
        return cur;
      });
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch {}
  }

  function speak(value) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.rate = 1;
    utterance.pitch = 1.1;
    utterance.onstart = () => {
      setStatus("speaking");
      startStopWatcher(); // start listening for "stop" in background
    };
    utterance.onend = () => {
      stopStopWatcher();
      setStatus("idle");
      setExpression("neutral");
      setTimeout(() => startListening(), 500);
    };
    utterance.onerror = () => {
      stopStopWatcher();
      setStatus("idle");
      setExpression("neutral");
      setTimeout(() => startListening(), 500);
    };
    window.speechSynthesis.speak(utterance);
  }

  function chooseExpression(value) {
    const lower = value.toLowerCase();
    if (/great|wonderful|awesome|happy|glad|love|excited|haha|funny|yay|perfect/.test(lower)) return "happy";
    if (/sorry|sad|unfortunately|upset|bad|apolog/.test(lower)) return "sad";
    if (/wow|surprise|really|amazing|whoa|oh my|incredible/.test(lower)) return "surprised";
    return "neutral";
  }

  async function sendMessage(message) {
    const clean = message.trim();
    if (!clean) { startListening(); return; }
    setStatus("thinking");
    setExpression("thinking");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean, history: [] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong.");
      setExpression(chooseExpression(data.reply));
      speak(data.reply);
    } catch {
      setExpression("sad");
      speak("I had trouble connecting. Please try again.");
    }
  }

  // Start listening on mount
  useEffect(() => {
    const timer = setTimeout(() => startListening(), 600);
    return () => {
      clearTimeout(timer);
      listeningRef.current = false;
      recognitionRef.current?.stop();
      stopStopWatcher();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const faceClass = `robot-face ${expression} ${status === "speaking" ? "speaking" : ""}`;

  return (
    <main className="stage">
      <div className={faceClass}>
        <div className="face-glow" />
        <div className="face-shine" />
        <div className="eyes">
          <div className="eye left"><i /><div className="eye-shine" /></div>
          <div className="eye right"><i /><div className="eye-shine" /></div>
        </div>
        <div className="cheeks"><i /><i /></div>
        <div className="mouth">
          <span /><span /><span /><span /><span />
        </div>
      </div>
    </main>
  );
}
