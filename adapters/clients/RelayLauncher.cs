using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
// Byte forwarding launcher. No shell, argument reinterpretation, or window.
public class RelayLauncher {
  static Thread Forward(Stream source, Stream target, bool closeTarget) {
    var thread=new Thread(()=>{try{var buffer=new byte[16384];int count;while((count=source.Read(buffer,0,buffer.Length))>0){target.Write(buffer,0,count);target.Flush();}if(closeTarget)target.Close();}catch(IOException){}});
    thread.IsBackground=true;thread.Start();return thread;
  }
  static string Quote(string value) {
    var text=new StringBuilder("\""); int slashes=0;
    foreach(char character in value) {
      if(character=='\\') {slashes++;continue;}
      if(character=='\"')text.Append('\\',slashes*2+1);
      else text.Append('\\',slashes);
      slashes=0;text.Append(character);
    }
    text.Append('\\',slashes*2);text.Append('"');return text.ToString();
  }
  public static int Main(string[] args) {
    var directory=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
    var configuration=File.ReadAllLines(Path.Combine(directory,"launcher.txt"));
    var nodePath=configuration[0];
    var arguments=new StringBuilder(Quote(configuration[1]));
    foreach(var argument in args)arguments.Append(" ").Append(Quote(argument));
    var start=new ProcessStartInfo(nodePath,arguments.ToString()) {UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
    using(var process=Process.Start(start)) {
      var input=Forward(Console.OpenStandardInput(),process.StandardInput.BaseStream,true);
      var output=Forward(process.StandardOutput.BaseStream,Console.OpenStandardOutput(),false);
      var error=Forward(process.StandardError.BaseStream,Console.OpenStandardError(),false);
      process.WaitForExit();output.Join();error.Join();return process.ExitCode;
    }
  }
}
