// deno-lint-ignore-file no-explicit-any
import fs from "node:fs";

import { Client, TypeDef, TypeDefKind } from "../client.ts";
import { connect } from "../connect.ts";
import { _ } from "../../deps.ts";
import {
  getArgsType,
  getReturnType,
  getObjectReturnType,
  getObjectArgType,
} from "./lib.ts";
import invoke from "./invoke.ts";
import introspect from "./introspect.ts";

let moduleEntrypoint = "file:///src/mod.ts";

if (fs.existsSync("/src/.fluentci/mod.ts")) {
  moduleEntrypoint = "file:///src/.fluentci/mod.ts";
}

const module = await import(moduleEntrypoint);
const metadata = introspect(moduleEntrypoint);
const functions = metadata.map((m) => m.functionName);

if (!module) {
  throw new Error("Module not found");
}

const typeMap: Record<string, TypeDefKind> = {
  string: TypeDefKind.Stringkind,
  number: TypeDefKind.Integerkind,
  boolean: TypeDefKind.Booleankind,
  void: TypeDefKind.Voidkind,
};

const listTypeMap: Record<string, TypeDefKind> = {
  "string[]": TypeDefKind.Stringkind,
  "number[]": TypeDefKind.Integerkind,
  "boolean[]": TypeDefKind.Booleankind,
};

const functionDescription = (key: string) =>
  metadata.find((m) => m.functionName === key)?.doc || "";

export function main() {
  connect(async (client: Client) => {
    const fnCall = client.currentFunctionCall();
    let mod = client.currentModule();

    const name = await fnCall.name();
    let returnValue;

    if (name === "") {
      const moduleName = await mod.name();
      let objDef = client.typeDef().withObject(moduleName);

      for (const key of functions) {
        objDef = register(client, key, objDef, functionDescription(key));
      }

      mod = mod.withObject(objDef);
      const id = await mod.id();
      returnValue = `"${id}"`;
    } else {
      const args = await fnCall.inputArgs();
      console.log("function call name => ", name);

      const argsType = getArgsType(metadata, name);
      const variableValues: any[] = [];
      for (const arg of args) {
        const argName = await arg.name();
        const argValue = await arg.value();
        console.log("args => ", argName, argValue, typeof argValue);

        variableValues.push(
          parseArg(
            argValue,
            argsType.find((a) => a.name === argName)?.type || "String"
          )
        );
      }

      const result = invoke(module[name], ...variableValues);

      console.log("=> result", result);

      returnValue = `"${result}"`;
    }

    await fnCall.returnValue(returnValue as any);
  });
}

function parseArg(value: any, type: string) {
  switch (type) {
    case "String":
      return value.replace(/"/g, "");
    case "Int":
      return parseInt(value);
    case "Boolean":
      return /^\s*(true|1|on)\s*$/i.test(value);
    case "[String]":
      return JSON.parse(value);
    case "[Int]":
      return JSON.parse(value);
    case "[Boolean]":
      return JSON.parse(value);
    default:
      return value;
  }
}

function register(
  client: Client,
  functionName: any,
  objDef: TypeDef,
  fnDesc: string
) {
  const returnType = getReturnType(metadata, functionName);
  const argsType = getArgsType(metadata, functionName);
  const objectReturnType = getObjectReturnType(metadata, functionName);

  let fn = client.function_(
    functionName,
    objectReturnType
      ? client.typeDef().withObject(objectReturnType)
      : client.typeDef().withKind(typeMap[returnType!])
  );

  for (const arg of argsType) {
    const objectType = getObjectArgType(metadata, functionName, arg.name);
    if (objectType) {
      fn = fn.withArg(
        arg.name,
        client.typeDef().withObject(objectType).withOptional(arg.optional)
      );
      continue;
    }

    if (listTypeMap[arg.type]) {
      fn = fn.withArg(
        arg.name,
        client
          .typeDef()
          .withListOf(client.typeDef().withKind(listTypeMap[arg.type]))
          .withOptional(arg.optional)
      );
      continue;
    }

    fn = fn.withArg(
      arg.name,
      client.typeDef().withKind(typeMap[arg.type]).withOptional(arg.optional)
    );
  }

  fn = fn.withDescription(fnDesc);

  return objDef.withFunction(fn);
}

// Learn more at https://deno.land/manual/examples/module_metadata#concepts
if (import.meta.main) {
  main();
}
