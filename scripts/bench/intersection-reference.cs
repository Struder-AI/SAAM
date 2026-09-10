// Development reference only: unmodified Clipper2 C# source at the revision
// recorded in DEVELOP.md; the production kernel is C++ compiled to WASM.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Clipper2ZLib;

class Reference {
  static void Main(string[] args) {
    var output=new List<object>();
    foreach(var item in JsonDocument.Parse(File.ReadAllText(args[0])).RootElement.EnumerateArray()) {
      var a=item.GetProperty("a");var b=item.GetProperty("b");
      var points=a.EnumerateArray().Concat(b.EnumerateArray()).SelectMany(l=>l.EnumerateArray()).ToArray();
      var origin=new[]{points.Length==0?0:points.Min(p=>p[0].GetDouble()),points.Length==0?0:points.Min(p=>p[1].GetDouble())};
      double precision=item.GetProperty("precisionMm").GetDouble();
      Paths64 Encode(JsonElement region) => new Paths64(region.EnumerateArray().Select(loop=>new Path64(loop.EnumerateArray().Select(p=>new Point64(
        (long)Math.Round((p[0].GetDouble()-origin[0])/precision,MidpointRounding.AwayFromZero),
        (long)Math.Round((p[1].GetDouble()-origin[1])/precision,MidpointRounding.AwayFromZero),0)))));
      var engine=new Clipper64{PreserveCollinear=false};
      engine.AddSubject(Encode(a));engine.AddClip(Encode(b));
      var solution=new Paths64();
      var op=item.GetProperty("operation").GetString();
      if(!engine.Execute(op=="intersect"?ClipType.Intersection:op=="union"?ClipType.Union:ClipType.Difference,FillRule.NonZero,solution))
        throw new Exception("Reference operation failed");
      output.Add(new{name=item.GetProperty("name").GetString(),loops=solution.Select(loop=>loop.Select(p=>new[]{origin[0]+p.X*precision,origin[1]+p.Y*precision}).ToArray()).ToArray()});
    }
    Console.WriteLine(JsonSerializer.Serialize(output));
  }
}
