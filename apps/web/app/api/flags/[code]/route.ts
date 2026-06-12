import { NextResponse } from 'next/server';
import { FIFA_TO_ISO2 } from '../../../../lib/flags';

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const params = await ctx.params;
  const iso = FIFA_TO_ISO2[params.code?.toUpperCase() ?? ''];
  if (!iso) return new NextResponse('unknown country', { status: 404 });
  return NextResponse.redirect(`https://flagcdn.com/w80/${iso}.png`, 302);
}
