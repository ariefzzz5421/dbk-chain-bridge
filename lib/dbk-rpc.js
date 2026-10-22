import { getNetworkRpc } from './network-health';
export async function resolveDbkRpc(){
 const url=await getNetworkRpc('dbk');
 return {result:{_url:url}};
}
export async function resolveEthRpc(){
 const url=await getNetworkRpc('ethereum');
 return {result:{_url:url}};
}
