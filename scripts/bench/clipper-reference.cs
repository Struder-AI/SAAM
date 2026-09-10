// Optional developer reference runner, compiled with the UNMODIFIED clipper.cs
// from arendvw/clipper (Clipper 6.4.2). No Rhino or production dependency.
// See DEVELOP.md, Shared offset functions, for the reproducible invocation.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using ClipperLib;

class Reference {
  static List<List<IntPoint>> Paths(JsonElement source, double[] origin, double precision) => source.EnumerateArray().Select(
    loop => loop.EnumerateArray().Select(p => new IntPoint(
      (long)Math.Round((p[0].GetDouble()-origin[0])/precision,MidpointRounding.AwayFromZero),
      (long)Math.Round((p[1].GetDouble()-origin[1])/precision,MidpointRounding.AwayFromZero))).ToList()).ToList();
  static void Main(string[] args) {
    var document=JsonDocument.Parse(File.ReadAllText(args[0]));
    var output=new List<object>();
    foreach(var item in document.RootElement.EnumerateArray()) {
      double precision=item.GetProperty("precisionMm").GetDouble(),delta=item.GetProperty("delta").GetDouble();
      var input=item.GetProperty("loops"); var all=input.EnumerateArray().SelectMany(l=>l.EnumerateArray()).ToArray();
      var origin=new double[]{all.Min(p=>p[0].GetDouble()),all.Min(p=>p[1].GetDouble())};
      var normalizer=new Clipper();normalizer.StrictlySimple=true;normalizer.AddPaths(Paths(input,origin,precision),PolyType.ptSubject,true);
      var normalized=new PolyTree();normalizer.Execute(ClipType.ctUnion,normalized,PolyFillType.pftNonZero,PolyFillType.pftNonZero);
      var paths=Clipper.PolyTreeToPaths(normalized);
      var offset=new ClipperOffset(2,item.GetProperty("arcToleranceMm").GetDouble()/precision);
      var join=item.GetProperty("join").GetString();
      offset.AddPaths(paths,join=="miter"?JoinType.jtMiter:join=="square"?JoinType.jtSquare:JoinType.jtRound,EndType.etClosedPolygon);
      var tree=new PolyTree();offset.Execute(ref tree,delta/precision);
      var cleanup=new Clipper();cleanup.StrictlySimple=true;cleanup.AddPaths(Clipper.PolyTreeToPaths(tree),PolyType.ptSubject,true);
      tree=new PolyTree();cleanup.Execute(ClipType.ctUnion,tree,PolyFillType.pftNonZero,PolyFillType.pftNonZero);
      output.Add(new {name=item.GetProperty("name").GetString(),loops=Clipper.PolyTreeToPaths(tree).Select(loop=>loop.Select(
        p=>new double[]{origin[0]+p.X*precision,origin[1]+p.Y*precision}).ToArray()).ToArray()});
    }
    Console.WriteLine(JsonSerializer.Serialize(output));
  }
}
