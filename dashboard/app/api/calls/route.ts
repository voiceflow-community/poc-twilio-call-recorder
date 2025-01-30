import { NextResponse } from 'next/server';

const BUN_SERVER = process.env.BUN_SERVER || 'http://localhost:3002';

export async function GET() {
  try {
    const response = await fetch(`${BUN_SERVER}/calls`);

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error(`Expected JSON but got ${contentType}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching calls:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: 'Failed to fetch calls', details: errorMessage },
      { status: 500 }
    );
  }
}
