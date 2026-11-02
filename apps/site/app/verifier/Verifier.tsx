'use client';

// Lecture du QR par la caméra et vérification sur le téléphone (UC-06, R-QR-05).
// Hors ligne, la page, son code et les clés publiques viennent du service worker.
import { parsePublicKeys, verifyCertificateQr, type PublicKeyJwk, type Verdict } from '@sabou/qr';
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import VerdictView from './VerdictView';
import styles from './Verifier.module.css';

const SCAN_INTERVAL_MS = 120;
// Image réduite avant décodage : assez pour un QR de version 13, léger pour un petit processeur
const SCAN_MAX_WIDTH = 640;

type Phase =
  | { name: 'idle' }
  | { name: 'scanning' }
  | { name: 'done'; verdict: Verdict }
  | { name: 'error'; message: string };

/** Texte du QR visible sur l'image courante de la caméra, ou null s'il n'y en a pas. */
function readQrText(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return null;
  const scale = Math.min(1, SCAN_MAX_WIDTH / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return (
    jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  );
}

export default function Verifier() {
  const [keys, setKeys] = useState<PublicKeyJwk[] | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Service worker limité à cette page : il la garde, avec les clés, pour le hors ligne
    navigator.serviceWorker
      ?.register('/verifier-sw.js', { scope: '/verifier' })
      .catch(() => console.warn('Service worker non enregistré : pas de vérification hors ligne'));
    fetch('/cles-certificats.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((body: { keys?: unknown }) => setKeys(parsePublicKeys(body.keys)))
      .catch(() => setKeys([]));
  }, []);

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startScan = useCallback(async () => {
    if (!keys || keys.length === 0) return;
    stopCamera();
    setPhase({ name: 'scanning' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      const tick = () => {
        if (streamRef.current !== stream) return;
        const text = readQrText(video, canvas);
        if (text === null) {
          timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS);
          return;
        }
        stopCamera();
        setPhase({ name: 'done', verdict: verifyCertificateQr(text, keys) });
      };
      tick();
    } catch (error) {
      stopCamera();
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      setPhase({
        name: 'error',
        message: denied
          ? 'L’accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur, puis réessayez.'
          : 'Aucune caméra utilisable sur cet appareil.',
      });
    }
  }, [keys, stopCamera]);

  const keysMissing = keys !== null && keys.length === 0;

  return (
    <section aria-labelledby="scan-title">
      <h2 id="scan-title" className={styles.visuallyHidden}>
        Lecture du QR code
      </h2>
      {keysMissing && (
        <p role="alert">
          Les clés de vérification ne sont pas encore sur ce téléphone. Ouvrez cette page une
          première fois avec du réseau.
        </p>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={startScan}
        disabled={keys === null || keysMissing || phase.name === 'scanning'}
      >
        {phase.name === 'done' ? 'Scanner un autre QR code' : 'Scanner un QR code'}
      </button>
      <video
        ref={videoRef}
        className={styles.video}
        hidden={phase.name !== 'scanning'}
        muted
        playsInline
        aria-label="Aperçu de la caméra"
      />
      <div role="status" aria-live="polite">
        {phase.name === 'scanning' && <p>Placez le QR code dans le cadre de la caméra.</p>}
        {phase.name === 'error' && <p>{phase.message}</p>}
        {phase.name === 'done' && <VerdictView verdict={phase.verdict} />}
      </div>
    </section>
  );
}
