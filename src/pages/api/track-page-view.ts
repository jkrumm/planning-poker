import { type NextRequest, NextResponse, userAgent } from "next/server";
import { env } from "fpp/env.mjs";
import { connect } from "@planetscale/database";
import { RouteType, type Visitor } from "@prisma/client";

const decodeBlob = async <T>(req: NextRequest): Promise<T> => {
  const buffer = Buffer.from(await req.arrayBuffer());
  const jsonString = buffer.toString();
  return JSON.parse(jsonString) as T;
};

export const config = {
  runtime: "edge",
  regions: ["fra1"],
};

export default async function handler(req: NextRequest) {
  let payload: {
    visitorId: string | null;
    route: RouteType;
    room?: string;
  } | null = null;
  try {
    if (req.method !== "POST") {
      // TODO: bad request
      throw new Error("invalid method");
    }

    const { visitorId, route, room } = await decodeBlob<{
      visitorId: string | null;
      route: RouteType;
      room?: string;
    }>(req);
    payload = { visitorId, route, room };
    validateInput({ visitorId, route, room });

    const conn = connect({
      url: env.DATABASE_URL,
    });

    let visitor: Visitor | null = null;
    if (visitorId) {
      const visitorQuery = await conn.execute(
        "SELECT * FROM Visitor WHERE id = ? LIMIT 1;",
        [visitorId]
      );
      visitor = visitorQuery.rows ? (visitorQuery.rows[0] as Visitor) : null;
    }

    if (!visitor) {
      const v = getVisitorPayload(req);
      const visitorUuid = crypto.randomUUID();
      await conn.execute(
        "INSERT INTO Visitor (id, browser, device, os, city, country, region) VALUES (?, ?, ?, ?, ?, ?, ?);",
        [visitorUuid, v.browser, v.device, v.os, v.city, v.country, v.region]
      );
      visitor = { id: visitorUuid } as Visitor;
    }

    await conn.execute(
      "INSERT INTO PageView (visitorId, route, room) VALUES (?, ?, ?);",
      [visitor.id, route, room]
    );

    return NextResponse.json({ visitorId: visitor.id }, { status: 200 });
  } catch (e) {
    // TODO: handle bad request
    console.error(e, payload);
    return NextResponse.json({ error: "InternalServerError" }, { status: 500 });
  }
}

const validateInput = ({
  visitorId,
  route,
  room,
}: {
  visitorId: string | null;
  route: RouteType;
  room?: string;
}): void => {
  if (visitorId && visitorId.length !== 36) {
    // TODO: bad request
    throw new Error("invalid visitorId");
  }

  if (RouteType[route] === undefined) {
    // TODO: bad request
    throw new Error("invalid route");
  }

  const roomCleaned = room
    ? room.replace(/[^A-Za-z]/g, "").toLowerCase()
    : null;

  if (room && (room !== roomCleaned || room.length > 15 || room.length < 3)) {
    // TODO: bad request
    throw new Error("invalid room");
  }
};

const getVisitorPayload = (req: NextRequest) => {
  const ua = userAgent(req);

  const geo = {
    country: req?.geo?.country ?? null,
    region: req?.geo?.region ?? null,
    city: req?.geo?.city ?? null,
  };

  // let geo: { country: string; region: string; city: string } | null = null;

  /*// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const ip: string | null =
    req.ip ??
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    req.headers["x-forwarded-for"] ??
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    req.headers["x-real-ip"] ??
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    req.headers["x-client-ip"] ??
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    req.headers["x-cluster-client-ip"] ??
    null;

  if (ip && env.NEXT_PUBLIC_NODE_ENV === "production") {
    const url = `'https://ipapi.co/${ip}/json/'`;

    try {
      const resp = await fetch(url);

      const apiData = (await resp.json()) as {
        city: string;
        country_code_iso3: string;
        region: string;
      };

      geo = {
        country: apiData.country_code_iso3,
        region: apiData.region,
        city: apiData.city,
      };
    } catch (e) {
      throw new Error("ip address fetch failed");
    }
  }*/

  return {
    browser: ua?.browser?.name ?? null,
    device: ua?.device?.type ?? "desktop",
    os: ua?.os?.name ?? null,
    city: geo?.city ?? null,
    country: geo?.country ?? null,
    region: geo?.region ?? null,
  };
};