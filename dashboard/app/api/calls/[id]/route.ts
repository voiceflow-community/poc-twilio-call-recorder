import { NextResponse } from 'next/server';

// Keep track of deleted IDs to prevent duplicate deletes
const deletedIds = new Set<string>();

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;

    // Check if this ID was already deleted
    if (deletedIds.has(id)) {
      console.log('🚫 Skipping duplicate delete request for:', id);
      return NextResponse.json(null, { status: 204 });
    }

    console.log('🗑️ Starting deletion process for call:', id);

    // Add ID to deleted set
    deletedIds.add(id);

    // Make DELETE request to the server
    const response = await fetch(`http://localhost:3902/api/calls/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      // Remove ID from deleted set if delete failed
      deletedIds.delete(id);
      throw new Error(`Failed to delete call (status: ${response.status})`);
    }

    // Keep the ID in the deleted set to prevent future duplicate deletes
    return NextResponse.json(null, { status: 204 });
  } catch (error) {
    console.error('❌ Error deleting call:', error);
    return NextResponse.json(
      { error: 'Failed to delete call' },
      { status: 500 }
    );
  }
}
