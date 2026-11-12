import { EvidenceInputError, getInspectionEvidence } from '@/lib/inspections';

export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.getAll('ccn').length !== 1 || params.getAll('limit').length > 1) {
      throw new EvidenceInputError('Supply one CCN and at most one limit.');
    }
    return Response.json(getInspectionEvidence(params.get('ccn')!, params.get('limit') ?? undefined), {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (error) {
    if (error instanceof EvidenceInputError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
