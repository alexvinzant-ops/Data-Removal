# Data Removal — a do-it-yourself Optery

A small app that helps you find and remove your personal information from
people-search sites and data brokers (Spokeo, Whitepages, BeenVerified, Intelius,
TruePeopleSearch and about 25 more).

It runs on your own computer, and your information is saved only there. The app:

- **scans for you**: with one click (or automatically every few days) it visits
  14 people-search sites, reads the results, and tells you which ones list you. It
  also searches the web for your name, phone numbers and emails, and shows other
  sites that mention you
- builds **search links** that look you up on each site, under every name and city you've used
- shows the **opt-out page and steps** for each site, including which sites one
  opt-out also covers (one PeopleConnect request covers Intelius, TruthFinder,
  Instant Checkmate and others)
- **drafts removal-request emails** that cite the CCPA and other privacy laws, for
  any site, including ones you add yourself
- **tracks status** (not listed → listed → removal requested → removed), with
  listing URLs, notes and a history for each site
- shows a **to-do list**: what to request, what to follow up on (default 30 days
  after a request), and what to re-check (default 90 days after a site is clear,
  because brokers often re-add people)
- keeps a list of **your own sites**, for anything else you or the scan find on the web

## Run it

Requires Node.js 18 or newer (download the LTS version from https://nodejs.org).

Download this repository (green **Code** button → **Download ZIP**) and unzip it, then open a terminal in that folder:

- **Windows:** open the folder in File Explorer, click the address bar, type `cmd`, and press Enter.
- **Mac:** open Terminal, type `cd ` (with a space), drag the folder into the window, and press Return.

The first time only, run this to install the part that lets scans use your browser:

```bash
npm install
```

Then, every time, run:

```bash
npm start
```

Leave the terminal open while you use the app. Open http://localhost:7100, add your info under **My info**, then work through
the **Dashboard** to-do list.

Your data is saved in `data/state.json`, which git ignores. Use
**Settings → Download backup** to keep a copy.

## How scanning works

Click **Scan now** on the dashboard. The scan opens Microsoft Edge or Google Chrome
(whichever you have) in its own window and visits each site's search page, the same
way you would. Then it reads the results:

- **You are listed**: your name appears next to something else of yours (your age,
  a phone number, a street address, an email, or another city you've lived in). The
  site moves to "Listed — remove" and the scan saves the link to your listing.
- **Someone with your name is listed**: only your name matched. It may be a
  namesake, so the dashboard asks you to check it. The more you fill in under
  **My info**, the more sure the scan can be.
- **No listing found**: the site is marked "Not listed". If you had requested
  removal, it's marked "Removed".
- **The site blocked the scan**: some sites show a "prove you are human" check.
  If the browser window is showing, tick the box yourself; the scan waits up to a
  minute and then carries on. Otherwise check that site by hand.

It also searches DuckDuckGo for your name with each city, and for your phone
numbers and emails. Results that mention you appear under **Found on the web**,
where you can add them to your list or dismiss them.

A full scan takes about 5–10 minutes. While the app is running, it scans again
every 7 days (change this in **Settings**). Scans can't remove you; you still
submit each opt-out, which usually needs you to click a link in an email.

Some things to know:

- Scans can miss a listing, for example one filed under a city you didn't add, so
  "No listing found" isn't a guarantee.
- Sites like PeopleConnect, BeenVerified and PeopleFinders only show results in
  their opt-out tool, so the scan can't check them. The dashboard tells you which
  sites to check by hand.
- Without `npm install`, scans run in a basic mode without a browser, and many sites block them.

## If something goes wrong

**"'npm' is not recognized as an internal or external command"** (Windows) or
**"command not found: npm"** (Mac) means the terminal can't find Node.js. Try these in order:

1. **Close the terminal and open a new one.** A terminal that was already open
   when you installed Node.js doesn't know about it yet. This fixes it most of the time.
2. **Check that Node.js is installed.** In the new terminal, type `node --version`
   and press Enter. If you see a version number like `v22.11.0`, Node.js is
   installed; go back to the folder and run `npm start` again.
3. **Install Node.js.** If you don't see a version number, download the **LTS**
   version from https://nodejs.org and run the installer. Keep the default options;
   on Windows, make sure **Add to PATH** stays selected. Then open a new terminal
   and try again.
4. **Restart your computer** if it still doesn't work after installing.

**"Missing script: start"** or **"Could not read package.json"** means the terminal
isn't in the app's folder. Open it again in the `Date-Removal-main` folder (the
one that holds `package.json` and `server.js`), as described above. If you
unzipped it into a folder of the same name, it may be one folder deeper.

**Scans say every site blocked them** or the dashboard says "Basic mode": run
`npm install` in the app folder, then restart the app. You also need Microsoft Edge
or Google Chrome installed. Windows always has Edge.

**"EADDRINUSE"** means the app is already running in another terminal window.
Use that one, or close it first.

**The page won't load** in your browser: check that the terminal window is still
open and shows `Data Removal running at http://localhost:7100`.

## Tips

- Use a separate email address just for opt-outs. Most sites email you a
  confirmation link, and you don't want to give them your main address.
- Start with the "Major site" entries. They feed many of the smaller ones.
- Add old addresses and maiden or other names. Brokers file records under all of them.
- California residents can also use the state's free DROP platform (Delete
  Request and Opt-out Platform) to send one deletion request to every registered data broker.

## Keeping the site list current

Broker sites change their opt-out pages often. All links and steps are in
`brokers.js`. If one breaks, fix it there and restart. Don't rename an `id` once
you've used it, because your saved status is stored under it.

## Settings

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `7100` | Port to listen on |
| `HOST` | `127.0.0.1` | Only this computer can reach the app. Setting another host requires `PASSWORD`. |
| `PASSWORD` | none | Turns on a browser password prompt (any user name). Required if you expose the app beyond this computer. |
| `DATA_FILE` | `data/state.json` | Where your information is saved |

This app holds your home addresses, phone numbers and emails. Keep it on your
own computer rather than deploying it to a public host.
