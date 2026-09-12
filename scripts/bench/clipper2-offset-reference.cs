// Optional developer reference runner, compiled with unmodified Clipper2 C#
// sources at the revision recorded in DEVELOP.md. Production uses C++/WASM.
// See DEVELOP.md, Shared offset functions, for the reproducible invocation.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Clipper2ZLib;

class Reference {
  static Paths64 Paths(JsonElement source, double[] origin, double precision) => new Paths64(source.EnumerateArray().Select(
    loop => new Path64(loop.EnumerateArray().Select(p => new Point64(
      (long)Math.Round((p[0].GetDouble()-origin[0])/precision,MidpointRounding.AwayFromZero),
      (long)Math.Round((p[1].GetDouble()-origin[1])/precision,MidpointRounding.AwayFromZero),0)))));
  static Paths64 Normalize(Paths64 paths) {
    var engine=new Clipper64{PreserveCollinear=false};engine.AddSubject(paths);
    var result=new Paths64();
    if(!engine.Execute(ClipType.Union,FillRule.NonZero,result))throw new Exception("Reference normalization failed.");
    return result;
  }
  static void Main(string[] args) {
    var document=JsonDocument.Parse(File.ReadAllText(args[0]));
    var output=new List<object>();
    foreach(var item in document.RootElement.EnumerateArray()) {
      double precision=item.GetProperty("precisionMm").GetDouble(),delta=item.GetProperty("delta").GetDouble();
      var input=item.GetProperty("loops"); var all=input.EnumerateArray().SelectMany(l=>l.EnumerateArray()).ToArray();
      var origin=new double[]{all.Length==0?0:all.Min(p=>p[0].GetDouble()),all.Length==0?0:all.Min(p=>p[1].GetDouble())};
      var paths=Normalize(Paths(input,origin,precision));
      var join=item.GetProperty("join").GetString();
      var miter=item.TryGetProperty("miterLimit",out var limit)?limit.GetDouble():2;
      var result=Normalize(Clipper.InflatePaths(paths,delta/precision,
        join=="miter"?JoinType.Miter:join=="square"?JoinType.Square:JoinType.Round,
        EndType.Polygon,miter,item.GetProperty("arcToleranceMm").GetDouble()/precision));
      output.Add(new {name=item.GetProperty("name").GetString(),loops=result.Select(loop=>loop.Select(
        p=>new double[]{origin[0]+p.X*precision,origin[1]+p.Y*precision}).ToArray()).ToArray()});
    }
    Console.WriteLine(JsonSerializer.Serialize(output));
  }
}
