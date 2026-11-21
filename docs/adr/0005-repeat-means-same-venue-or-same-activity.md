# A repeat is the same venue, or the same activity kind outside food

The app never offers a Repeat. For food, a Repeat is the same venue only, because a new restaurant is a new date. For shows, classes and active Ideas, the same activity kind somewhere else is a Repeat too, because a second pottery class is not a new date. We rejected "same venue only", which lets a second pottery class through, and "same category", which runs out of restaurants after one dinner.

Venues match on their normalized name, either exactly or when one name is the other plus more words. Activity kinds match when their core words overlap by half or more, after generic words such as "class" or "experience" are removed. The rule lives in `src/domain/repeat.ts`.

## Consequences

- An Idea that is a Repeat is still stored, with the status `repeat`, so the scout's next run does not bring it back as new.
- A Favourite comes back only when the Owner asks Muse for one.
