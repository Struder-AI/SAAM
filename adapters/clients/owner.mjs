// Native plugin direct child: the engine itself is our parent, without a shell.
process.stdout.write(String(process.ppid));
