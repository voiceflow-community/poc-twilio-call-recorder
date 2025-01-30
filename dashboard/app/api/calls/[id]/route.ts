import { type NextRequest } from 'next/server';

const BUN_SERVER = process.env.BUN_SERVER || 'http://localhost:3002';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, context: any) {
  const { id } = context.params;
  try {
    // Try to delete from Twilio first, but don't fail if it errors
    try {
      const twilioResponse = await fetch(`https://intelligence.twilio.com/v2/Transcripts/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Basic ${btoa(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`)}`
        }
      });

      if (!twilioResponse.ok) {
        console.warn(`Warning: Failed to delete from Twilio (status: ${twilioResponse.status}). Continuing with local deletion.`);
      }
    } catch (error) {
      console.warn('Warning: Failed to contact Twilio API:', error);
      // Continue with local deletion even if Twilio fails
    }

    // Delete from our database
    const response = await fetch(`${BUN_SERVER}/calls/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete from database (status: ${response.status})`);
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting call:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return Response.json(
      { error: 'Failed to delete call', details: errorMessage },
      { status: 500 }
    );
  }
}
