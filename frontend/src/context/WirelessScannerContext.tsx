import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  io,
  type Socket,
} from 'socket.io-client';

interface WirelessScannerContextValue {
  sessionId: string | null;
  connected: boolean;
  lastScan: {
  code: string;
  id: number;
} | null;
  error: string;
  createSession: () => void;
  disconnectScanner: () => void;
}

const WirelessScannerContext =
  createContext<WirelessScannerContextValue | null>(
    null
  );

export function WirelessScannerProvider({
  children,
}: {
  children: ReactNode;
}) {
    const scanIdRef =
  useRef(0);

  const socketRef =
    useRef<Socket | null>(null);

  const [
    sessionId,
    setSessionId,
  ] = useState<string | null>(
    null
  );

  const [
    connected,
    setConnected,
  ] = useState(false);

  const [
  lastScan,
  setLastScan,
] = useState<{
  code: string;
  id: number;
} | null>(null);

  const [
    error,
    setError,
  ] = useState('');

  useEffect(() => {
    const socket = io({
      path: '/socket.io',

      transports: [
        'polling',
        'websocket',
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
        setError('');
      }
    );

    socket.on(
      'scanner:connected',
      () => {
        setConnected(true);
        setError('');
      }
    );

    socket.on(
      'scanner:disconnected',
      () => {
        setConnected(false);
      }
    );

    socket.on(
  'scanner:barcode',
  (payload: { code?: string }) => {
    const code =
      payload?.code?.trim();

    if (!code) {
      return;
    }

    scanIdRef.current += 1;

setLastScan({
  code,
  id: scanIdRef.current,
});
  }
);

    socket.on(
      'connect_error',
      (err) => {
        console.error(
          'Wireless scanner socket error:',
          err
        );

        setError(
          'Unable to connect wireless scanner.'
        );
      }
    );

    return () => {
      socket.removeAllListeners();
      socket.disconnect();

      socketRef.current = null;
    };
  }, []);

  function createSession() {
    const socket =
      socketRef.current;

    if (
      !socket ||
      !socket.connected
    ) {
      setError(
        'Scanner connection is not ready.'
      );

      return;
    }

    socket.emit(
      'scanner:create-session',
      (
        response: {
          success: boolean;
          sessionId?: string;
          error?: string;
        }
      ) => {
        if (
          !response.success ||
          !response.sessionId
        ) {
          setError(
            response.error ??
              'Unable to create scanner session.'
          );

          return;
        }

        setSessionId(
          response.sessionId
        );

        setConnected(false);
        setError('');
      }
    );
  }

  function disconnectScanner() {
    const socket =
      socketRef.current;

    if (
      socket &&
      sessionId
    ) {
      socket.emit(
        'scanner:close-session',
        {
          sessionId,
        }
      );
    }

    setSessionId(null);
    setConnected(false);
    setLastScan(null);
  }

  const value =
    useMemo<WirelessScannerContextValue>(
      () => ({
        sessionId,
        connected,
        lastScan,
        error,
        createSession,
        disconnectScanner,
      }),
      [
        sessionId,
        connected,
        lastScan,
        error,
      ]
    );

  return (
    <WirelessScannerContext.Provider
      value={value}
    >
      {children}
    </WirelessScannerContext.Provider>
  );
}

export function useWirelessScanner() {
  const context =
    useContext(
      WirelessScannerContext
    );

  if (!context) {
    throw new Error(
      'useWirelessScanner must be used within WirelessScannerProvider'
    );
  }

  return context;
}