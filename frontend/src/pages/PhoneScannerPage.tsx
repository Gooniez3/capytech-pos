import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from '@zxing/browser';

import {
  CheckCircle2,
  Loader2,
  ScanLine,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';

import {
  io,
  type Socket,
} from 'socket.io-client';

type ScannerStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'invalid';

export function PhoneScannerPage() {
  const videoRef =
    useRef<HTMLVideoElement | null>(
      null
    );

  const controlsRef =
    useRef<IScannerControls | null>(
      null
    );

  const socketRef =
    useRef<Socket | null>(
      null
    );

  const processingRef =
    useRef(false);

  const lastScanRef =
    useRef<{
      code: string;
      time: number;
    } | null>(null);

  const [
    status,
    setStatus,
  ] = useState<ScannerStatus>(
    'connecting'
  );

  const [
    cameraStarted,
    setCameraStarted,
  ] = useState(false);

  const [
    cameraError,
    setCameraError,
  ] = useState('');

  const [
    scannerMessage,
    setScannerMessage,
  ] = useState(
    'Connecting to POS...'
  );

  const [
    lastBarcode,
    setLastBarcode,
  ] = useState('');

  const [
    scanSuccess,
    setScanSuccess,
  ] = useState(false);

  /* =========================================================
     SESSION
     ========================================================= */

  const sessionId =
    new URLSearchParams(
      window.location.search
    ).get('session');

  /* =========================================================
   SOCKET CONNECTION
   ========================================================= */

useEffect(() => {
  if (!sessionId) {
    setStatus('invalid');

    setScannerMessage(
      'Scanner session is missing.'
    );

    return;
  }

  console.log(
    'Scanner session:',
    sessionId
  );

  const socket = io({
  path: '/socket.io',

  transports: [
    'websocket',
    'polling',
  ],

  tryAllTransports: true,

  timeout: 5000,

  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 500,
});

  socketRef.current = socket;

  socket.on(
    'connect',
    () => {
      console.log(
        'Phone scanner socket connected:',
        socket.id
      );

      setScannerMessage(
        'Pairing with POS...'
      );

      socket.emit(
        'scanner:join',
        {
          sessionId,
        },
        (
          response: {
            success: boolean;
            error?: string;
          }
        ) => {
          if (!response.success) {
            setStatus('invalid');

            setScannerMessage(
              response.error ??
                'Unable to pair with POS.'
            );

            return;
          }

          setStatus('connected');

          setScannerMessage(
            'Connected to POS'
          );
        }
      );
    }
  );

  socket.on(
    'disconnect',
    () => {
      setStatus('disconnected');

      setScannerMessage(
        'Connection to POS lost.'
      );
    }
  );

  socket.on(
    'scanner:session-closed',
    () => {
      setStatus('invalid');

      setScannerMessage(
        'This scanner session has ended.'
      );

      controlsRef.current?.stop();

      controlsRef.current = null;
    }
  );

  socket.on(
    'connect_error',
    (error) => {
      console.error(
        'Phone scanner socket error:',
        error
      );

      setStatus('disconnected');

      setScannerMessage(
        `Unable to connect to POS: ${error.message}`
      );
    }
  );

  return () => {
    socket.removeAllListeners();

    socket.disconnect();

    socketRef.current = null;
  };
}, [sessionId]);



  /* =========================================================
     CAMERA
     ========================================================= */

  useEffect(() => {
    if (
      status !== 'connected'
    ) {
      return;
    }

    let cancelled = false;

    async function startCamera() {
      if (!videoRef.current) {
        return;
      }

      setCameraError('');

      try {
        const reader =
          new BrowserMultiFormatReader();

        const controls =
          await reader.decodeFromConstraints(
            {
              audio: false,

              video: {
                facingMode: {
                  ideal:
                    'environment',
                },
              },
            },

            videoRef.current,

            async (
              result
            ) => {
              if (
                !result ||
                processingRef.current
              ) {
                return;
              }

              const code =
                result
                  .getText()
                  .trim();

              if (!code) {
                return;
              }

              /* -----------------------------------------
                 DUPLICATE PROTECTION
                 ----------------------------------------- */

              const now =
                Date.now();

              const previous =
                lastScanRef.current;

              if (
                previous &&
                previous.code ===
                  code &&
                now -
                  previous.time <
                  1200
              ) {
                return;
              }

              lastScanRef.current =
                {
                  code,
                  time: now,
                };

              processingRef.current =
                true;

              setLastBarcode(
                code
              );

              setScanSuccess(
                false
              );

              setScannerMessage(
                'Sending to POS...'
              );

              const socket =
                socketRef.current;

              if (
                !socket ||
                !socket.connected
              ) {
                setScannerMessage(
                  'POS connection lost.'
                );

                processingRef.current =
                  false;

                return;
              }

              socket.emit(
                'scanner:barcode',
                {
                  sessionId,
                  code,
                },
                (
                  response: {
                    success: boolean;
                    error?: string;
                  }
                ) => {
                  if (
                    response.success
                  ) {
                    setScanSuccess(
                      true
                    );

                    setScannerMessage(
                      'Sent to POS'
                    );

                    /*
                     * Short delay prevents
                     * immediate duplicate reads.
                     */

                    window.setTimeout(
                      () => {
                        setScanSuccess(
                          false
                        );

                        setScannerMessage(
                          'Ready to scan'
                        );

                        processingRef.current =
                          false;
                      },
                      900
                    );

                    return;
                  }

                  setScanSuccess(
                    false
                  );

                  setScannerMessage(
                    response.error ??
                      'Unable to send barcode.'
                  );

                  window.setTimeout(
                    () => {
                      processingRef.current =
                        false;
                    },
                    1000
                  );
                }
              );
            }
          );

        if (cancelled) {
          controls.stop();

          return;
        }

        controlsRef.current =
          controls;

        setCameraStarted(
          true
        );

        setScannerMessage(
          'Ready to scan'
        );
      } catch (error) {
        console.error(
          'Phone camera error:',
          error
        );

        setCameraStarted(
          false
        );

        setCameraError(
          'Unable to access your camera. Please allow camera permission and try again.'
        );
      }
    }

    const timer =
      window.setTimeout(
        () => {
          startCamera();
        },
        200
      );

    return () => {
      cancelled = true;

      window.clearTimeout(
        timer
      );

      controlsRef.current?.stop();

      controlsRef.current =
        null;

      processingRef.current =
        false;
    };
  }, [
    status,
    sessionId,
  ]);

  /* =========================================================
     INVALID SESSION
     ========================================================= */

  if (
    status === 'invalid'
  ) {
    return (
      <div
        className="
          flex
          min-h-[100dvh]
          items-center
          justify-center
          bg-slate-950
          px-6
          text-white
        "
      >
        <div
          className="
            w-full
            max-w-sm
            text-center
          "
        >
          <div
            className="
              mx-auto
              mb-5
              flex
              h-16
              w-16
              items-center
              justify-center
              rounded-2xl
              bg-red-500/10
              text-red-400
            "
          >
            <WifiOff
              className="
                h-8
                w-8
              "
            />
          </div>

          <h1
            className="
              text-xl
              font-bold
            "
          >
            Scanner unavailable
          </h1>

          <p
            className="
              mt-2
              text-sm
              leading-6
              text-slate-400
            "
          >
            {scannerMessage}
          </p>

          <p
            className="
              mt-5
              text-xs
              text-slate-500
            "
          >
            Open Phone Scanner
            from the desktop POS
            and scan a new QR code.
          </p>
        </div>
      </div>
    );
  }

  /* =========================================================
     UI
     ========================================================= */

  return (
    <div
      className="
        flex
        min-h-[100dvh]
        flex-col
        bg-slate-950
        text-white
      "
    >
      {/* HEADER */}

      <header
        className="
          flex
          h-16
          shrink-0
          items-center
          justify-between
          border-b
          border-white/10
          px-4
        "
      >
        <div
          className="
            flex
            items-center
            gap-3
          "
        >
          <div
            className="
              flex
              h-10
              w-10
              items-center
              justify-center
              rounded-xl
              bg-white/10
            "
          >
            <Smartphone
              className="
                h-5
                w-5
              "
            />
          </div>

          <div>
            <p
              className="
                text-sm
                font-bold
              "
            >
              CapyTech Scanner
            </p>

            <p
              className="
                text-[11px]
                text-slate-400
              "
            >
              Wireless POS Scanner
            </p>
          </div>
        </div>

        <div
          className={`
            flex
            items-center
            gap-1.5
            rounded-full
            px-2.5
            py-1
            text-[11px]
            font-semibold

            ${
              status ===
              'connected'
                ? `
                    bg-emerald-500/10
                    text-emerald-400
                  `
                : `
                    bg-amber-500/10
                    text-amber-400
                  `
            }
          `}
        >
          {status ===
          'connected' ? (
            <Wifi
              className="
                h-3.5
                w-3.5
              "
            />
          ) : (
            <Loader2
              className="
                h-3.5
                w-3.5
                animate-spin
              "
            />
          )}

          {status ===
          'connected'
            ? 'Connected'
            : 'Connecting'}
        </div>
      </header>

      {/* CAMERA */}

      <main
        className="
          flex
          flex-1
          flex-col
          px-4
          pb-[max(24px,env(safe-area-inset-bottom))]
          pt-4
        "
      >
        <div
          className="
            relative
            flex-1
            overflow-hidden
            rounded-3xl
            border
            border-white/10
            bg-black
          "
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="
              absolute
              inset-0
              h-full
              w-full
              object-cover
            "
          />

          {/* DARK OVERLAY */}

          <div
            className="
              pointer-events-none
              absolute
              inset-0
              bg-black/10
            "
          />

          {/* SCANNING FRAME */}

          <div
            className="
              pointer-events-none
              absolute
              left-1/2
              top-1/2
              h-48
              w-[85%]
              max-w-sm
              -translate-x-1/2
              -translate-y-1/2
              rounded-2xl
              border-2
              border-white/90
            "
          >
            <div
              className="
                absolute
                left-4
                right-4
                top-1/2
                h-0.5
                -translate-y-1/2
                bg-red-500
                shadow-lg
              "
            />
          </div>

          {/* CAMERA LOADING */}

          {!cameraStarted &&
            !cameraError && (
              <div
                className="
                  absolute
                  inset-0
                  flex
                  flex-col
                  items-center
                  justify-center
                  bg-slate-950
                "
              >
                <Loader2
                  className="
                    mb-4
                    h-8
                    w-8
                    animate-spin
                    text-slate-400
                  "
                />

                <p
                  className="
                    text-sm
                    text-slate-400
                  "
                >
                  Starting camera...
                </p>
              </div>
            )}

          {/* SUCCESS FLASH */}

          {scanSuccess && (
            <div
              className="
                absolute
                inset-0
                flex
                items-center
                justify-center
                bg-emerald-500/20
                backdrop-blur-[2px]
              "
            >
              <div
                className="
                  flex
                  h-20
                  w-20
                  items-center
                  justify-center
                  rounded-full
                  bg-emerald-500
                  shadow-xl
                "
              >
                <CheckCircle2
                  className="
                    h-10
                    w-10
                  "
                />
              </div>
            </div>
          )}
        </div>

        {/* CAMERA ERROR */}

        {cameraError && (
          <div
            className="
              mt-4
              rounded-2xl
              border
              border-red-500/20
              bg-red-500/10
              px-4
              py-3
              text-sm
              leading-5
              text-red-300
            "
          >
            {cameraError}
          </div>
        )}

        {/* STATUS */}

        <div
          className="
            mt-4
            rounded-2xl
            border
            border-white/10
            bg-white/5
            p-4
          "
        >
          <div
            className="
              flex
              items-center
              gap-3
            "
          >
            <div
              className={`
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                rounded-xl

                ${
                  scanSuccess
                    ? `
                        bg-emerald-500/20
                        text-emerald-400
                      `
                    : `
                        bg-white/10
                        text-slate-300
                      `
                }
              `}
            >
              {scanSuccess ? (
                <CheckCircle2
                  className="
                    h-5
                    w-5
                  "
                />
              ) : (
                <ScanLine
                  className="
                    h-5
                    w-5
                  "
                />
              )}
            </div>

            <div
              className="
                min-w-0
                flex-1
              "
            >
              <p
                className="
                  text-sm
                  font-semibold
                "
              >
                {scannerMessage}
              </p>

              {lastBarcode ? (
                <p
                  className="
                    mt-1
                    truncate
                    font-mono
                    text-xs
                    text-slate-400
                  "
                >
                  {lastBarcode}
                </p>
              ) : (
                <p
                  className="
                    mt-1
                    text-xs
                    text-slate-500
                  "
                >
                  Point the camera
                  at a product barcode
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}