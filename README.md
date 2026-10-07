# Profile Expressions — Connection Profile

Experimental SillyTavern 1.19.x UI extension.

It classifies the visible emotion of a selected character using a **separate SillyTavern Connection Profile** through `ConnectionManagerRequestService`, without switching the active RP connection profile.

The result is applied to the built-in **Character Expressions** extension using `/costume` and `/expression-set`.

## Important

This is a test build. Start with manual testing on one character before enabling automatic classification.

## Files

These files must be in the **ROOT of the GitHub repository**:

- `manifest.json`
- `index.js`
- `style.css`
- `README.md`

Do **not** upload them inside an extra nested folder.

## Put this on GitHub

1. On GitHub click **New repository**.
2. Example repository name:
   `ST-Profile-Expressions`
3. Public repository is the simplest option.
4. Create the repository.
5. Choose **Add file → Upload files**.
6. Upload the four files from this package directly into the repository root.
7. Commit the files.
8. Copy the repository URL, for example:
   `https://github.com/YOURNAME/ST-Profile-Expressions`

## Install in browser-based SillyTavern

1. Open SillyTavern.
2. Open **Extensions**.
3. Choose **Install Extension**.
4. Paste the GitHub repository URL.
5. Install.
6. Reload SillyTavern.

You do not need file-system access to the SillyTavern server when the server allows normal Git extension installation.

## First setup

Keep the built-in **Character Expressions** extension enabled.

In built-in Character Expressions:
- Set classifier source/API to **Local**, not Main API.
- Keep your sprites uploaded normally.

In **Profile Expressions — Connection Profile**:
- Do NOT enable automatic classification yet.
- Select a separate cheap Connection Profile, for example your Qwen profile.
- Set `Кого классифицируем` to the character name, for example `Clark`.
- Set `Папка спрайтов Character Expressions` to the exact Character Expressions sprite folder name.
- Check/edit the allowed emotion labels.

Open a chat whose latest AI message contains that character and press:

**Тест на последнем посте**

Expected status example:

`✓ Clark: amusement`

If the sprite changes correctly, then enable automatic classification.

## What v0.1 does

- Reads the latest AI message.
- Sends only that message plus a short classification instruction to the selected Connection Profile.
- Does not switch the active RP profile.
- Expects one emotion label.
- Runs `/costume <sprite folder>`.
- Runs `/expression-set <emotion>`.

## Current limitation

v0.1 tracks one configured target character.

If the basic mechanism works, a later version can detect markers such as:

- `[CLARK]`
- `[JIMMY]`
- `[PERRY]`

and automatically select both the NPC sprite folder and the current expression.

## If something breaks

Disable this extension in **Manage Extensions** and reload SillyTavern.

For debugging, open browser DevTools with `F12`, go to **Console**, and look for lines beginning with:

`[Profile Expressions Test]`
