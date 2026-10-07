"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().then(() => setPlaying(true));
    else { video.pause(); setPlaying(false); }
  };

  return <>
    <video ref={videoRef} src="/uploads/Create_a_realistic_cinematic_h.mp4" poster="/uploads/hero-video-first-frame.png" muted loop playsInline aria-label="Zwei Servicetechniker prüfen eine Kreiselpumpe und einen Kompressor in einer Werkshalle" />
    <button className="video-toggle" type="button" onClick={toggle} aria-label={playing ? "Hintergrundvideo anhalten" : "Hintergrundvideo abspielen"}><Icon name={playing ? "pause" : "play"} size={17} /></button>
  </>;
}
