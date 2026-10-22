import { NextResponse } from 'next/server';
import { getAllNetworks } from '../../../lib/network-health';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=45;
export async function GET(){
 try{return NextResponse.json(await getAllNetworks(),{headers:{'Cache-Control':'no-store'}})}
 catch{return NextResponse.json({ok:false,error:'NETWORK_DIAGNOSTICS_FAILED'}, {status:503,headers:{'Cache-Control':'no-store'}})}
}
