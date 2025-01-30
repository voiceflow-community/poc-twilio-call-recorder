interface ExportProps {
  calls: Array<{
    id: string;
    from: string;
    to: string;
    duration: string;
    recordingUrl: string;
    piiUrl: string;
    transcript: Array<{
      speaker: 'customer' | 'assistant';
      text: string;
    }>;
  }>;
}

export function Export({ calls }: ExportProps) {
  const downloadCSV = () => {
    const headers = ['ID', 'From', 'To', 'Duration', 'Recording URL', 'PII URL', 'Transcript'];
    const rows = calls.map(call => [
      call.id,
      call.from,
      call.to,
      call.duration,
      call.recordingUrl,
      call.piiUrl,
      call.transcript.map(t => `${t.speaker}: ${t.text}`).join(' | ')
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `calls_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const downloadJSON = () => {
    const jsonContent = JSON.stringify(calls, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `calls_export_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={downloadCSV}
        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
      >
        Export CSV
      </button>
      <button
        onClick={downloadJSON}
        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Export JSON
      </button>
    </div>
  );
}
