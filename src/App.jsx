import { useEffect, useRef, useState } from "react";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function App() {
  const [status, setStatus] = useState("idle");
  const [expression, setExpression] = useState("neutral");
  const detectedLangRef = useRef("en-IN");   // last detected language from speech
  const recognitionRef = useRef(null);
  const stopWatchRef = useRef(null);
  const listeningRef = useRef(false);

  // ── Parallel "stop" watcher — runs while MIRAI is speaking ──
  function startStopWatcher() {
    if (!SpeechRecognition) return;
    stopStopWatcher();

    const rec = new SpeechRecognition();
    rec.lang = detectedLangRef.current;   // use last known language
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const word = event.results[i][0].transcript.trim().toLowerCase();
        // "stop" in many languages
        if (/\bstop\b|\bरुको\b|\bरोको\b|\bbasta\b|\barrêt\b|\bstopp\b|\bстоп\b|\b停止\b|\b止まれ\b|\b멈춰\b|\bdur\b/.test(word)) {
          window.speechSynthesis.cancel();
          stopStopWatcher();
          setStatus("idle");
          setExpression("neutral");
          setTimeout(() => startListening(), 600);
          return;
        }
      }
    };

    rec.onerror = () => {};
    rec.onend = () => {
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
    // Empty string = browser uses OS default and accepts any language input
    recognition.lang = "";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listeningRef.current = true;
      setStatus("listening");
      setExpression("listening");
    };

    recognition.onresult = event => {
      const result = event.results[0][0];
      const heard = result.transcript.trim();
      // Chrome exposes the detected language on the result object
      const detectedLang = event.results[0].lang || result.lang || detectedLangRef.current;
      if (detectedLang) detectedLangRef.current = detectedLang;
      listeningRef.current = false;
      sendMessage(heard, detectedLangRef.current);
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

  function speak(value, lang) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = lang || detectedLangRef.current;
    utterance.rate = 1;
    utterance.pitch = 1.1;

    // Pick the best matching voice for the detected language
    const voices = window.speechSynthesis.getVoices();
    const targetLang = utterance.lang;
    const match =
      voices.find(v => v.lang === targetLang) ||
      voices.find(v => v.lang.startsWith(targetLang.split("-")[0]));
    if (match) utterance.voice = match;

    utterance.onstart = () => {
      setStatus("speaking");
      startStopWatcher();
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
    const t = value.toLowerCase();
    if (/haha|lol|hilarious|funny|joke|laugh|hehe/.test(t))                              return "laughing";
    if (/angry|annoyed|frustrated|ridiculous|absurd|rude|unacceptable/.test(t))          return "angry";
    if (/great|wonderful|awesome|happy|glad|love|excited|yay|perfect|fantastic/.test(t)) return "happy";
    if (/sorry|sad|unfortunately|upset|apolog|miss|lonely|hurt|disappoint/.test(t))      return "sad";
    if (/wow|incredible|amazing|whoa|oh my|unbelievable|no way/.test(t))                 return "surprised";
    if (/hmm|not sure|confus|unclear|what do you mean|perhaps|maybe/.test(t))            return "confused";
    if (/boring|whatever|okay|sure|fine|i see|understood|noted/.test(t))                 return "bored";
    return "neutral";
  }

  async function sendMessage(message, lang) {
    const clean = message.trim();
    if (!clean) { startListening(); return; }
    setStatus("thinking");
    setExpression("thinking");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean, history: [], lang })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong.");
      setExpression(chooseExpression(data.reply));
      speak(data.reply, lang);
    } catch {
      setExpression("sad");
      speak("I had trouble connecting. Please try again.", "en-IN");
    }
  }

  // Start listening on mount; preload voices
  useEffect(() => {
    // Trigger voice list load (Chrome is async)
    window.speechSynthesis?.getVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", () => {
      window.speechSynthesis.getVoices();
    });
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
        <div className="brows">
          <div className="brow left" />
          <div className="brow right" />
        </div>
        <div className="eyes">
          <div className="eye left">
            <div className="eyelid" />
            <div className="pupil" />
          </div>
          <div className="eye right">
            <div className="eyelid" />
            <div className="pupil" />
          </div>
        </div>
        <div className="cheeks">
          <div className="cheek" />
          <div className="cheek" />
        </div>
        <div className="mouth-wrap">
          <div className="mouth">
            <div className="mouth-inner">
              <div className="mouth-line" />
            </div>
            <div className="eq-bars">
              <div className="eq-bar"/><div className="eq-bar"/><div className="eq-bar"/>
              <div className="eq-bar"/><div className="eq-bar"/><div className="eq-bar"/>
              <div className="eq-bar"/>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
