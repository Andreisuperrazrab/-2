'use strict';
// Simple local HTTP benchmark; run with BASE_URL=http://127.0.0.1:3000 node tests/benchmark.js
const base=process.env.BASE_URL||'http://127.0.0.1:3000';
const N=200, concurrency=10, records=[];
async function worker(){
  while(true){
    const index=records.length; // use a separate counter below
    if(index>=N)break;
    break;
  }
}
(async()=>{
  let next=0,errors=0;
  const begin=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<N){next++;const t=performance.now();
      try {const res=await fetch(`${base}/api/jobs`);await res.arrayBuffer();if(!res.ok)errors++;}
      catch{errors++;}
      records.push(performance.now()-t);
    }
  }));
  records.sort((a,b)=>a-b);
  const duration=performance.now()-begin;
  const percentile=p=>Number(records[Math.min(records.length-1,Math.floor((records.length-1)*p))].toFixed(2));
  const data={endpoint:'/api/jobs',requests:N,concurrency,errors,p50_ms:percentile(.5),p95_ms:percentile(.95),p99_ms:percentile(.99),total_ms:Number(duration.toFixed(2)),throughput_rps:Number((N*1000/duration).toFixed(1)),kind:'Local test; not production performance or an external Lighthouse audit'};
  console.log(JSON.stringify(data,null,2));
  if(errors)process.exitCode=1;
})();
