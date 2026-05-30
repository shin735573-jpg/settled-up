import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY = 'https://connector-gateway.lovable.dev/microsoft_onedrive/v1.0';

function gwHeaders() {
  const lovable = Deno.env.get('LOVABLE_API_KEY');
  const conn = Deno.env.get('MICROSOFT_ONEDRIVE_API_KEY');
  if (!lovable) throw new Error('LOVABLE_API_KEY 미설정');
  if (!conn) throw new Error('MICROSOFT_ONEDRIVE_API_KEY 미설정 (원드라이브 미연결)');
  return {
    Authorization: `Bearer ${lovable}`,
    'X-Connection-Api-Key': conn,
  };
}

async function ensureFolder(path: string) {
  // path like "정산서_저장/2026-05_월전체/업체"
  const parts = path.split('/').filter(Boolean);
  let parentPath = '';
  for (const part of parts) {
    const url = parentPath
      ? `${GATEWAY}/me/drive/root:/${encodeURI(parentPath)}:/children`
      : `${GATEWAY}/me/drive/root/children`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...gwHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: part,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'replace',
      }),
    });
    if (!res.ok && res.status !== 409) {
      const t = await res.text();
      throw new Error(`폴더 생성 실패 (${res.status}): ${t}`);
    }
    parentPath = parentPath ? `${parentPath}/${part}` : part;
  }
  return parentPath;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Verify JWT
    const auth = req.headers.get('Authorization');
    if (!auth) {
      return new Response(JSON.stringify({ error: '인증 필요' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: '인증 실패' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === 'verify') {
      const res = await fetch(`${GATEWAY}/me/drive`, { headers: gwHeaders() });
      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ ok: false, status: res.status, error: t }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const data = await res.json();
      return new Response(JSON.stringify({ ok: true, drive: { id: data.id, name: data.name, owner: data.owner?.user?.displayName } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'upload') {
      const { folder, filename, contentBase64, contentType } = body as {
        folder: string; filename: string; contentBase64: string; contentType?: string;
      };
      if (!folder || !filename || !contentBase64) {
        return new Response(JSON.stringify({ error: 'folder, filename, contentBase64 필수' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await ensureFolder(folder);
      const bin = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
      const uploadUrl = `${GATEWAY}/me/drive/root:/${encodeURI(folder)}/${encodeURIComponent(filename)}:/content`;
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { ...gwHeaders(), 'Content-Type': contentType || 'application/octet-stream' },
        body: bin,
      });
      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ error: `업로드 실패 (${res.status}): ${t}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const data = await res.json();
      return new Response(JSON.stringify({ ok: true, id: data.id, name: data.name, webUrl: data.webUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: '알 수 없는 action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});