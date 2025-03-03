import rebootpy
from rebootpy.errors import HTTPException
from fastapi import FastAPI, Form, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
import asyncio

app = FastAPI()
templates = Jinja2Templates(directory="templates")

class MyBot(rebootpy.Client):

    async def search_all_users(self, prefix: str, platform: rebootpy.UserSearchPlatform):
        if not isinstance(platform, rebootpy.UserSearchPlatform):
            raise TypeError(
                'The platform passed must be a constant from '
                'rebootpy.UserSearchPlatform'
            )

        res = await self.http.user_search_by_prefix(
            self.user.id,  # 自分のユーザーID
            prefix,        # 接頭辞を指定
            platform.value  # プラットフォーム指定
        )

        user_ids = [d['accountId'] for d in res]
        users = await self.fetch_users(user_ids, raw=True)
        lookup = {p['id']: p for p in users}

        entries = []
        for data in res:
            user_data = lookup.get(data['accountId'])
            if user_data is None:
                continue

            obj = rebootpy.UserSearchEntry(self, user_data, data)
            entries.append(obj)

        return entries

    search_profiles = search_all_users  # 互換性のために別名

# デバイス認証情報
auth = rebootpy.DeviceAuth(
    device_id='e471f2a3da024d389adbc4e54aaa499b',
    account_id='d6c08ae4b56843ea9f6412a56dc3da2d',
    secret='WBE6YY4QVQJTSAGFZJJORA2LMAUSXU3U'
)

bot = MyBot(auth=auth)

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/search")
async def search(request: Request, prefix: str = Form(...)):
    try:
        # EPIC_GAMESプラットフォームで検索を実行
        results = await bot.search_all_users(prefix, rebootpy.UserSearchPlatform.EPIC_GAMES)
        entries = []

        if results:
            for entry in results:
                external_auths = getattr(entry, 'external_auths', [])
                auth_info = "連携アカウント情報なし"
                if external_auths:
                    auth_info = ', '.join(
                        [f"{getattr(auth, 'type', '不明')}:{getattr(auth, 'external_display_name', '不明')}"
                         for auth in external_auths]
                    )

                entries.append({
                    'display_name': entry.display_name,
                    'id': entry.id,
                    'auth_info': auth_info
                })
        return templates.TemplateResponse("result.html", {"request": request, "results": entries})

    except HTTPException as e:
        return templates.TemplateResponse("error.html", {"request": request, "error": f"ユーザー検索中にエラーが発生しました: {e}"})

# サーバーを実行する
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
