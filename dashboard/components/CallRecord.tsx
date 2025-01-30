'use client';

import { useState } from 'react';
import { ArrowDownTrayIcon, DocumentTextIcon, TrashIcon } from '@heroicons/react/24/outline';

interface CallRecordProps {
  call: {
    id: string;
    from: string;
    to: string;
    duration: string;
    recordingUrl: string;
    piiUrl: string;
    createdAt: string;
    transcript: {
      speaker: 'customer' | 'assistant';
      text: string;
    }[];
  };
}

export function CallRecord({ call, onDelete }: CallRecordProps & { onDelete: (id: string) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this call? This action cannot be undone.')) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(call.id);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDuration = (seconds: string) => {
    const duration = parseInt(seconds);
    if (isNaN(duration)) return 'Unknown duration';

    if (duration < 60) {
      return `${duration} sec`;
    }
    const minutes = Math.floor(duration / 60);
    const remainingSeconds = duration % 60;
    return remainingSeconds > 0
      ? `${minutes} min ${remainingSeconds} sec`
      : `${minutes} min`;
  };

  const formatDateTime = (dateStr: string | undefined) => {
    if (!dateStr) {
      return 'Date not available';
    }

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        console.error('Invalid date:', dateStr);
        return 'Date not available';
      }
      return `${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Date not available';
    }
  };

  return (
    <div className={`relative border border-gray-700 rounded-lg p-4 bg-gray-800 shadow-sm ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}>
      {isDeleting && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      )}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-gray-100">Call {call.id}</h2>
          <p className="text-sm text-gray-400">
            From: {call.from} • To: {call.to} • Duration: {formatDuration(call.duration)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateTime(call.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <audio controls src={call.piiUrl} className="h-8 w-[300px] lg:w-[250px]" />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.open(call.piiUrl, '_blank')}
              className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              title="Download PII"
            >
              <ArrowDownTrayIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
              title={isExpanded ? 'Hide Transcript' : 'Show Transcript'}
            >
              <DocumentTextIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleDelete}
              className="p-2 bg-red-600 text-white rounded hover:bg-red-700"
              title="Delete"
              disabled={isDeleting}
            >
              <TrashIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-2">
          {call.transcript.map((line, i) => (
            <div
              key={i}
              className={`p-2 rounded ${
                line.speaker === 'customer' ? 'bg-blue-900/50' : 'bg-gray-700/50'
              }`}
            >
              <span className="font-medium">
                {line.speaker === 'customer' ? '👤' : '🤖'}:
              </span>{' '}
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
