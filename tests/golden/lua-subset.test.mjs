import assert from "node:assert/strict";
import test from "node:test";

import { LuaRuntime, LuaTable, standardLibrary, LuaSubsetError } from "../../machines/reference-dobot-mg400-struderbot/trace/lua-subset.mjs";

function run(source, host = {}) {
  const runtime = new LuaRuntime({ host: { ...standardLibrary(), ...host } });
  runtime.load(source, "test.lua");
  return runtime;
}

test("lua-subset: evaluates the arithmetic and precedence the generated Lua relies on", () => {
  const runtime = run("A = 2 + 3 * 4\nB = (2 + 3) * 4\nC = 2 ^ 3 ^ 2\nD = -2 ^ 2\nE = 7 % -3");
  assert.equal(runtime.getGlobal("A"), 14);
  assert.equal(runtime.getGlobal("B"), 20);
  assert.equal(runtime.getGlobal("C"), 512, "^ is right-associative");
  assert.equal(runtime.getGlobal("D"), -4, "^ binds tighter than unary minus");
  assert.equal(runtime.getGlobal("E"), -2, "Lua's % takes the sign of the divisor, unlike JavaScript's");
});

test("lua-subset: returns and assigns multiple values, as CalibratedXY does", () => {
  const runtime = run(`
    function Pair(x, y)
      if x > 0 then
        return x * 2, y * 3
      end
      return x, y
    end
    local a, b = Pair(4, 5)
    A = a
    B = b
    local c, d = Pair(-1, 5)
    C = c
    D = d
  `);
  assert.equal(runtime.getGlobal("A"), 8);
  assert.equal(runtime.getGlobal("B"), 15);
  assert.equal(runtime.getGlobal("C"), -1);
  assert.equal(runtime.getGlobal("D"), 5);
});

test("lua-subset: builds the nested tables a point constructor produces", () => {
  const runtime = run(`
    ACTIVE_TOOL = 1
    function P(x, y, z, r)
      return { coordinate = {x, y, z, r}, tool = ACTIVE_TOOL, user = 2 }
    end
    Result = P(1, 2, 3, 180)
  `);
  const result = runtime.getGlobal("Result");
  assert.ok(result instanceof LuaTable);
  assert.equal(result.get("tool"), 1);
  assert.equal(result.get("user"), 2);
  assert.deepEqual(result.get("coordinate").toArray(), [1, 2, 3, 180]);
});

test("lua-subset: only false and nil are falsy", () => {
  const runtime = run(`
    function Truthy(v) if v then return 1 end return 0 end
    Zero = Truthy(0)
    Empty = Truthy("")
    Nil = Truthy(nil)
    False = Truthy(false)
  `);
  assert.equal(runtime.getGlobal("Zero"), 1, "0 is truthy in Lua");
  assert.equal(runtime.getGlobal("Empty"), 1, '"" is truthy in Lua');
  assert.equal(runtime.getGlobal("Nil"), 0);
  assert.equal(runtime.getGlobal("False"), 0);
});

test("lua-subset: short-circuits and/or without evaluating the far side", () => {
  const calls = [];
  run(`
    local ignored = false and Boom()
    local also = true or Boom()
  `, { Boom: () => { calls.push("boom"); return [1]; } });
  assert.deepEqual(calls, []);
});

test("lua-subset: runs loops, including break", () => {
  const runtime = run(`
    Total = 0
    for i = 1, 10 do
      if i > 4 then break end
      Total = Total + i
    end
    Steps = 0
    local n = 8
    while n > 1 do n = n / 2 Steps = Steps + 1 end
    Down = 0
    for i = 5, 1, -2 do Down = Down + i end
  `);
  assert.equal(runtime.getGlobal("Total"), 10);
  assert.equal(runtime.getGlobal("Steps"), 3);
  assert.equal(runtime.getGlobal("Down"), 9);
});

test("lua-subset: closures see the globals defined by an earlier chunk", () => {
  const runtime = new LuaRuntime({ host: standardLibrary() });
  runtime.load("SPEED = 42\nfunction Fast() return SPEED end", "global.lua");
  runtime.load("function Ask() return Fast() end", "src1.lua");
  assert.deepEqual(runtime.call("Ask"), [42]);
});

test("lua-subset: host bindings receive a call stack rooted in the calling file", () => {
  const seen = [];
  const runtime = new LuaRuntime({
    host: { ...standardLibrary(), Move: (args, context) => { seen.push(context); } },
  });
  runtime.load("function Helper(x) Move(x) end", "global.lua");
  runtime.load("function Plan()\n  Helper(1)\nend", "src1.lua");
  runtime.call("Plan");

  assert.equal(seen.length, 1);
  const frames = seen[0].stack.filter((frame) => frame.line !== null);
  assert.equal(frames[0].file, "src1.lua", "outermost real frame is the call in the plan body");
  assert.equal(frames[0].line, 2);
  assert.equal(frames[0].call, "Helper");
  assert.equal(frames.at(-1).file, "global.lua", "innermost frame is where the primitive was reached");
  assert.equal(frames.at(-1).call, "Move");
});

test("lua-subset: user-defined functions take precedence over host bindings", () => {
  let hostCalls = 0;
  const runtime = run(
    "function Wait(ms) return ms * 2 end\nResult = Wait(10)",
    { Wait: () => { hostCalls += 1; return [0]; } }
  );
  assert.equal(runtime.getGlobal("Result"), 20);
  assert.equal(hostCalls, 0, "a project may wrap a primitive in its own Lua");
});

test("lua-subset: refuses an unknown function instead of ignoring it", () => {
  assert.throws(
    () => run("SomethingNobodyImplemented(1, 2)"),
    (error) => error instanceof LuaSubsetError && /unknown function "SomethingNobodyImplemented"/.test(error.message)
  );
});

test("lua-subset: refuses unsupported syntax, naming the line", () => {
  assert.throws(
    () => run("local t = {}\nfunction t:method() end"),
    (error) => error instanceof LuaSubsetError && error.line === 2
  );
});

test("lua-subset: stops a runaway loop rather than hanging a preview", () => {
  const runtime = new LuaRuntime({ host: standardLibrary(), stepLimit: 5000 });
  assert.throws(
    () => runtime.load("while true do end", "test.lua"),
    (error) => error instanceof LuaSubsetError && /exceeded 5000 steps/.test(error.message)
  );
});

test("lua-subset: handles comments, long comments, and strings", () => {
  const runtime = run(`
    -- a line comment
    --[[ a long
         comment ]]
    Name = "PEN" .. "_DO"
    Count = #"abcd"
  `);
  assert.equal(runtime.getGlobal("Name"), "PEN_DO");
  assert.equal(runtime.getGlobal("Count"), 4);
});
