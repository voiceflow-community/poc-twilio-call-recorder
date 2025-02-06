import { NextResponse } from 'next/server';

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3902';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '10';

    const response = await fetch(`${API_URL}/calls?page=${page}&limit=${limit}`);

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Invalid response format');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching calls:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calls' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Call ID is required' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_URL}/calls/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting call:', error);
    return NextResponse.json(
      { error: 'Failed to delete call' },
      { status: 500 }
    );
  }
}
