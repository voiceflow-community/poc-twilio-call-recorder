'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CallRecord } from './CallRecord';
import { SearchBar } from './SearchBar';
import { Pagination } from './Pagination';
import { Export } from './Export';

interface Call {
  id: string;
  from: string;
  to: string;
  from_number: string;
  to_number: string;
  duration: string;
  recordingUrl: string;
  piiUrl: string;
  createdAt: string;
  transcript: {
    speaker: 'customer' | 'assistant';
    text: string;
  }[];
}

interface PaginationData {
  total: number;
  pages: number;
  currentPage: number;
  limit: number;
}

export function CallList() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState<PaginationData>({
    total: 0,
    pages: 1,
    currentPage: 1,
    limit: 10
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchCalls = useCallback(async (page: number, search: string) => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
        ...(search && { search })
      });

      const response = await fetch(`/api/calls?${params}`);
      if (!response.ok) throw new Error('Failed to fetch calls');
      const data = await response.json();
      setCalls(data.calls);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
    } finally {
      setLoading(false);
    }
  }, [pagination.limit]);

  // Set up WebSocket connection with reconnection logic
  const setupWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use relative URL instead of hardcoded host
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;
    console.log('Setting up WebSocket connection to:', wsUrl, {
      protocol: window.location.protocol,
      host: window.location.host,
      wsProtocol: protocol
    });

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connection established successfully');
        setError(null);
        // Clear any existing reconnection timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = undefined;
        }
      };

      ws.onmessage = (event) => {
        try {
          console.log('Received WebSocket message:', event.data);
          const data = JSON.parse(event.data);
          if (data.type === 'new_call') {
            console.log('Processing new call:', data.call);
            // Add the new call to the beginning of the list and update pagination
            setCalls(prev => {
              console.log('Current calls:', prev.length);
              // Only add if not already in the list
              if (!prev.find(call => call.id === data.call.id)) {
                console.log('Adding new call to list');
                return [data.call, ...prev];
              }
              console.log('Call already in list, skipping');
              return prev;
            });
            setPagination(prev => ({
              ...prev,
              total: prev.total + 1,
              pages: Math.ceil((prev.total + 1) / prev.limit)
            }));
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        console.error('WebSocket state:', {
          readyState: ws.readyState,
          url: ws.url,
          protocol: ws.protocol,
          extensions: ws.extensions,
          bufferedAmount: ws.bufferedAmount,
          binaryType: ws.binaryType
        });
        setError('Failed to connect to WebSocket server');
      };

      ws.onclose = (event) => {
        console.log('WebSocket connection closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          readyState: ws.readyState
        });

        // Don't attempt to reconnect if the component is unmounting
        if (!wsRef.current) return;

        // Attempt to reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect WebSocket...');
          reconnectTimeoutRef.current = undefined;
          setupWebSocket();
        }, 5000);
      };

      return () => {
        console.log('Cleaning up WebSocket connection');
        wsRef.current = null; // Mark as intentionally closed
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = undefined;
        }
      };
    } catch (error) {
      console.error('Error setting up WebSocket:', error);
      setError('Failed to setup WebSocket connection');
      return () => {}; // Return empty cleanup function
    }
  }, []); // Empty dependency array since we don't use any external values

  // Initialize WebSocket connection
  useEffect(() => {
    const cleanup = setupWebSocket();
    return () => {
      cleanup();
    };
  }, [setupWebSocket]);

  // Fetch calls when page or search changes
  useEffect(() => {
    fetchCalls(pagination.currentPage, search);
  }, [pagination.currentPage, search, fetchCalls]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, currentPage: page }));
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/calls/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.details || 'Failed to delete call');
      }

      // Remove the deleted call from the state
      setCalls(prev => prev.filter(call => call.id !== id));
      setPagination(prev => ({
        ...prev,
        total: prev.total - 1,
        pages: Math.ceil((prev.total - 1) / prev.limit)
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete call');
      // Clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
    }
  };

  if (loading) return <div className="text-center py-4">Loading calls...</div>;
  if (error) return <div className="text-center py-4 text-red-500">Error: {error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <SearchBar value={search} onChange={handleSearch} />
        {calls.length > 0 && <Export calls={calls} />}
      </div>

      {!calls.length ? (
        <div className="text-center py-8 text-gray-500">
          {search ? 'No calls match your search' : 'No calls recorded yet'}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {calls.map(call => (
              <CallRecord key={call.id} call={call} onDelete={handleDelete} />
            ))}
          </div>

          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.pages}
            onPageChange={handlePageChange}
          />
        </>
      )}
    </div>
  );
}
