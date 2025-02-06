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
  recordingType: 'regular' | 'redacted';
  transcript_sid: string;
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
  const reconnectAttempts = useRef<number>(0);
  const limit = 10; // Move limit to component level constant

  const fetchCalls = useCallback(async (page: number, searchQuery: string) => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(searchQuery && { search: searchQuery })
      });

      const response = await fetch(`http://localhost:3902/api/calls?${params}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Surrogate-Control': 'no-store'
        }
      });
      if (!response.ok) throw new Error('Failed to fetch calls');
      const data = await response.json();
      setCalls(data.data || []);
      setPagination(prevPagination => ({
        ...prevPagination,
        total: data.pagination.total,
        pages: data.pagination.totalPages,
        currentPage: data.pagination.page,
        limit: data.pagination.limit
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
    } finally {
      setLoading(false);
    }
  }, []);

  // Set up WebSocket connection with reconnection logic
  const setupWebSocket = useCallback(() => {
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL}/ws`;
    console.log('Setting up WebSocket connection to:', wsUrl);

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
              // Only add if not already in the list
              if (!prev.find(call => call.id === data.call.id)) {
                return [data.call, ...prev];
              }
              return prev;
            });
            setPagination(prev => ({
              ...prev,
              total: prev.total + 1,
              pages: Math.ceil((prev.total + 1) / prev.limit)
            }));
          } else if (data.type === 'delete_call') {
            console.log('Processing call deletion:', data.id);
            // Remove the deleted call from the list
            setCalls(prev => prev.filter(call => call.id !== data.id));
            setPagination(prev => ({
              ...prev,
              total: Math.max(0, prev.total - 1),
              pages: Math.max(1, Math.ceil((prev.total - 1) / prev.limit))
            }));
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Failed to connect to WebSocket server');
      };

      ws.onclose = (event) => {
        console.log('WebSocket connection closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });

        // Don't attempt to reconnect if the component is unmounting
        if (!wsRef.current) return;

        // Attempt to reconnect after a delay that increases with each attempt
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000); // Max 30 seconds
        console.log(`Attempting to reconnect in ${delay}ms...`);

        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect WebSocket...');
          reconnectTimeoutRef.current = undefined;
          reconnectAttempts.current += 1;
          setupWebSocket();
        }, delay);
      };

      return () => {
        console.log('Cleaning up WebSocket connection');
        wsRef.current = null; // Mark as intentionally closed
        reconnectAttempts.current = 0; // Reset reconnect attempts on cleanup
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

  // Initialize data on component mount and when search changes
  useEffect(() => {
    // Always fetch first page when search changes
    const page = search ? 1 : pagination.currentPage;
    fetchCalls(page, search);
  }, [search, fetchCalls]);

  // Handle page changes separately
  useEffect(() => {
    if (!loading) { // Only fetch if not in initial loading state
      fetchCalls(pagination.currentPage, search);
    }
  }, [pagination.currentPage, fetchCalls, search, loading]);

  const handleSearch = (value: string) => {
    setSearch(value);
    // Reset to first page when searching
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, currentPage: page }));
  };

  const handleDelete = async (id: string) => {
    try {
      // Optimistically remove the call from the UI
      setCalls(prev => prev.filter(call => call.id !== id));
      setPagination(prev => ({
        ...prev,
        total: prev.total - 1,
        pages: Math.ceil((prev.total - 1) / prev.limit)
      }));

      const response = await fetch(`http://localhost:3902/api/calls/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        // If delete fails, add the call back
        const data = await response.json();
        throw new Error(data.details || 'Failed to delete call');
      }
    } catch (err) {
      // On error, refetch the calls to restore state
      console.error('Error deleting call:', err);
      fetchCalls(pagination.currentPage, search);
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
