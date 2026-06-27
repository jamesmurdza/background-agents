'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Terminal message types for WebSocket communication
 */
interface TerminalMessage {
  type: 'data' | 'ready' | 'exit' | 'pong';
  payload?: string;
  pid?: number;
  shell?: string;
  cwd?: string;
  exitCode?: number;
  signal?: number;
  timestamp?: number;
}

interface InputMessage {
  type: 'input' | 'resize' | 'ping';
  payload?: string;
  cols?: number;
  rows?: number;
}

export interface WebSocketTerminalProps {
  /**
   * The WebSocket URL to connect to (wss://...)
   */
  websocketUrl: string;

  /**
   * Optional className for the terminal container
   */
  className?: string;

  /**
   * Called when the terminal connects successfully
   */
  onConnect?: (pid: number) => void;

  /**
   * Called when the terminal disconnects
   */
  onDisconnect?: (code?: number, reason?: string) => void;

  /**
   * Called when a connection error occurs
   */
  onError?: (error: Error) => void;

  /**
   * Optional theme configuration
   */
  theme?: {
    background?: string;
    foreground?: string;
    cursor?: string;
    selection?: string;
  };

  /**
   * Font size in pixels
   */
  fontSize?: number;

  /**
   * Font family
   */
  fontFamily?: string;
}

/**
 * WebSocket-based Terminal component using xterm.js
 *
 * This component connects to a WebSocket PTY server running inside a Daytona
 * sandbox and provides a full interactive terminal experience.
 *
 * Features:
 * - Full PTY support (vim, htop, ssh, etc.)
 * - Real-time streaming
 * - Terminal resize handling
 * - Cursor blinking
 * - ANSI color support
 */
export function WebSocketTerminal({
  websocketUrl,
  className = '',
  onConnect,
  onDisconnect,
  onError,
  theme,
  fontSize = 13,
  fontFamily = 'Menlo, Monaco, "Courier New", monospace',
}: WebSocketTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const hasConnected = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalInstanceRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);

  // Handle resize
  const handleResize = useCallback(() => {
    if (fitAddonRef.current && terminalInstanceRef.current) {
      try {
        fitAddonRef.current.fit();

        // Send resize message to server
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          const { cols, rows } = terminalInstanceRef.current;
          const message: InputMessage = { type: 'resize', cols, rows };
          socketRef.current.send(JSON.stringify(message));
        }
      } catch (e) {
        // Ignore resize errors (element may not be mounted)
      }
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current || !websocketUrl || hasConnected.current) return;

    hasConnected.current = true;
    let socket: WebSocket | null = null;
    let terminal: any = null;
    let fitAddon: any = null;
    let resizeObserver: ResizeObserver | null = null;

    console.log('[WebSocketTerminal] Connecting to:', websocketUrl);

    // Dynamically import xterm to avoid SSR issues
    Promise.all([
      import('xterm'),
      import('xterm-addon-fit'),
      import('xterm-addon-web-links'),
    ])
      .then(([{ Terminal }, { FitAddon }, { WebLinksAddon }]) => {
        if (!terminalRef.current) return;

        // Create terminal instance
        terminal = new Terminal({
          cursorBlink: true,
          fontSize,
          fontFamily,
          theme: {
            background: theme?.background ?? '#1a1a1a',
            foreground: theme?.foreground ?? '#e0e0e0',
            cursor: theme?.cursor ?? '#ffffff',
            selectionBackground: theme?.selection ?? 'rgba(255, 255, 255, 0.3)',
          },
          allowProposedApi: true,
          scrollback: 10000,
        });

        terminalInstanceRef.current = terminal;

        // Load addons
        fitAddon = new FitAddon();
        fitAddonRef.current = fitAddon;
        terminal.loadAddon(fitAddon);

        const webLinksAddon = new WebLinksAddon();
        terminal.loadAddon(webLinksAddon);

        // Mount terminal
        terminal.open(terminalRef.current);

        // Initial fit
        setTimeout(() => {
          fitAddon.fit();
        }, 0);

        // Show connecting message
        terminal.writeln('\x1b[33mConnecting to sandbox terminal...\x1b[0m');

        // Connect WebSocket
        socket = new WebSocket(websocketUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          console.log('[WebSocketTerminal] WebSocket connected');
          terminal.writeln('\x1b[32mConnected!\x1b[0m\r\n');

          // Send initial resize
          const { cols, rows } = terminal;
          const message: InputMessage = { type: 'resize', cols, rows };
          socket?.send(JSON.stringify(message));
        };

        socket.onerror = (err) => {
          console.error('[WebSocketTerminal] WebSocket error:', err);
          terminal.writeln('\x1b[31mConnection error\x1b[0m');
          onError?.(new Error('WebSocket connection error'));
        };

        socket.onmessage = (event) => {
          try {
            const message: TerminalMessage = JSON.parse(event.data);

            switch (message.type) {
              case 'data':
                if (message.payload) {
                  terminal.write(message.payload);
                }
                break;

              case 'ready':
                console.log('[WebSocketTerminal] PTY ready, PID:', message.pid);
                onConnect?.(message.pid ?? 0);
                break;

              case 'exit':
                console.log('[WebSocketTerminal] PTY exited:', message.exitCode);
                terminal.writeln(`\r\n\x1b[33mProcess exited with code ${message.exitCode}\x1b[0m`);
                break;

              case 'pong':
                // Connection health check response
                break;
            }
          } catch (error) {
            console.error('[WebSocketTerminal] Parse error:', error);
          }
        };

        socket.onclose = (event) => {
          console.log('[WebSocketTerminal] Disconnected:', event.code, event.reason);
          terminal.writeln('\r\n\x1b[31mDisconnected from terminal\x1b[0m');
          onDisconnect?.(event.code, event.reason);
        };

        // Handle terminal input
        terminal.onData((data: string) => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            const message: InputMessage = { type: 'input', payload: data };
            socket.send(JSON.stringify(message));
          }
        });

        // Handle terminal resize via ResizeObserver
        resizeObserver = new ResizeObserver(() => {
          handleResize();
        });
        resizeObserver.observe(terminalRef.current);

        // Also handle window resize
        window.addEventListener('resize', handleResize);
      })
      .catch((error) => {
        console.error('[WebSocketTerminal] Failed to load xterm:', error);
        onError?.(error);
      });

    // Cleanup
    return () => {
      console.log('[WebSocketTerminal] Cleaning up');
      hasConnected.current = false;

      window.removeEventListener('resize', handleResize);

      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      if (socket) {
        socket.close();
        socketRef.current = null;
      }

      if (terminal) {
        terminal.dispose();
        terminalInstanceRef.current = null;
      }

      fitAddonRef.current = null;
    };
  }, [websocketUrl, fontSize, fontFamily, theme, onConnect, onDisconnect, onError, handleResize]);

  return (
    <div
      ref={terminalRef}
      className={`h-full w-full ${className}`}
      style={{
        backgroundColor: theme?.background ?? '#1a1a1a',
        padding: '4px',
      }}
    />
  );
}

export default WebSocketTerminal;
