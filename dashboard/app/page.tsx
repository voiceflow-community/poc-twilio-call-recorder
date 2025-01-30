import { CallList } from '@/components/CallList';

export default function Home() {
  return (
    <main className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Call Recordings</h1>
      <CallList />
    </main>
  );
}
