import io
s = io.open('index.html', encoding='utf-8').read()
def rep(old, new, cnt=1):
    global s
    assert s.count(old) >= cnt, 'MISS: ' + old[:70]
    s = s.replace(old, new, cnt)

# 1. proxShadow array
rep("""  const usage=new Int16Array(TS);        // 每单元当前被几个网络占用
  const hist=new Float32Array(TS);       // 历史拥塞代价""",
"""  const usage=new Int16Array(TS);        // 每单元当前被几个网络占用
  const hist=new Float32Array(TS);       // 历史拥塞代价
  const proxShadow=new Float32Array(TS); // 邻近阴影""")

# 2. commitPath tail: add proximity shadow after tree.add
rep("""      if(!net.cells.has(s)){ net.cells.add(s); usage[s]++; }
      tree.add(s);
      prev=s;
    }
    net.paths.push(path.map(s=>{""",
"""      if(!net.cells.has(s)){ net.cells.add(s); usage[s]++; }
      tree.add(s);
      // 邻近阴影：向 4 邻域扩散 0.3 间距压力
      const sc=s%NC, sl=(s/NC)|0;
      for(const ddx of [1,-1,0]) for(const ddy of [1,-1,0]) {
        if(ddx===0 && ddy===0) continue;
        if(ddx!==0 && ddy!==0) continue;
        const nx=sc+ddx, ny=sl+ddy;
        if(nx>=0 && nx<GW && ny>=0 && ny<GH) {
          const ns2=sl*NC+ny*GW+nx;
          if(!net.cells.has(ns2)) proxShadow[ns2]=Math.min(proxShadow[ns2]+0.3, 2.0);
        }
      }
      prev=s;
    }
    net.paths.push(path.map(s=>{""")

# 3. A*: add proxShadow to edge cost
rep("        let ec=1+hist[ns];",
    "        let ec=1+hist[ns]+proxShadow[ns];")

# 4. A*: neighbor proximity penalty
rep("        const ng=gc+ec;",
"""        if(!hard) {
          const tc2=ns%NC;
          let nearPen=0;
          if(tc2+1<GW && usage[ns+1]>0 && !net.cells.has(ns+1)) nearPen+=3;
          if(tc2-1>=0 && usage[ns-1]>0 && !net.cells.has(ns-1)) nearPen+=3;
          const nr2=(ns/NC)|0;
          if(nr2+1<GH && usage[ns+GW]>0 && !net.cells.has(ns+GW)) nearPen+=3;
          if(nr2-1>=0 && usage[ns-GW]>0 && !net.cells.has(ns-GW)) nearPen+=3;
          ec+=nearPen;
        }
        const ng=gc+ec;""")

io.open('index.html', 'w', encoding='utf-8').write(s)
print('optimized OK')
