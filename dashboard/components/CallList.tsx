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

  // Set up WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const bunServer = process.env.NEXT_PUBLIC_BUN_SERVER || 'http://localhost:3902';
    const wsHost = bunServer.replace(/^https?:\/\//, '');

    console.log('Connecting to WebSocket:', `${protocol}//${wsHost}/ws`);

    const ws = new WebSocket(`${protocol}//${wsHost}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected successfully');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'new_call') {
        setCalls(prev => [data.call, ...prev]);
        setPagination(prev => ({
          ...prev,
          total: prev.total + 1,
          pages: Math.ceil((prev.total + 1) / prev.limit)
        }));
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Failed to connect to WebSocket server');
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []); // Only run once on mount

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
