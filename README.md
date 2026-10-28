# Data Removal — a do-it-yourself Optery

A small app that helps you find and remove your personal information from
people-search sites and data brokers (Spokeo, Whitepages, BeenVerified, Intelius,
TruePeopleSearch and about 25 more).

It runs on your own computer, and your information never leaves it. It doesn't
contact the broker sites itself. You open each site in your browser, and the app:

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
- keeps a list of **your own sites**, for anything else you find through Google, Bing or DuckDuckGo

## Run it

Requires Node.js 18 or newer (download the LTS version from https://nodejs.org). There is nothing else to install.

Download this repository (green **Code** button → **Download ZIP**) and unzip it, then open a terminal in that folder:

- **Windows:** open the folder in File Explorer, click the address bar, type `cmd`, and press Enter.
- **Mac:** open Terminal, type `cd ` (with a space), drag the folder into the window, and press Return.

Then run:

```bash
npm start
```

Leave the terminal open while you use the app. Open http://localhost:7100, add your info under **My info**, then work through
the **Dashboard** to-do list.

Your data is saved in `data/state.json`, which git ignores. Use
**Settings → Download backup** to keep a copy.

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
