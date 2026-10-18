import "server-only";

// Bundled common-password list (SPEC M01, server only). Lower-cased. Bases are also
// matched with trailing digits/symbols stripped ("Password2024!" → "password").
// Compiled from public breach-frequency lists (top entries); extend freely.
const LIST = `
password passw0rd p@ssword p@ssw0rd pa55word passwort motdepasse contrasena senha
123456 1234567 12345678 123456789 1234567890 12345678910 0123456789 987654321 9876543210
111111 1111111111 000000 0000000000 121212 123123 123123123 123321 654321 666666 696969
777777 7777777 888888 112233 11223344 123qwe 1q2w3e 1q2w3e4r 1q2w3e4r5t 1qaz2wsx 1qazxsw2
zaq12wsx zaq1zaq1 qwerty qwerty1 qwerty123 qwertyuiop qwertyui qwer1234 asdfgh asdfghjkl
asdf1234 zxcvbn zxcvbnm azerty abc123 abcd1234 abcdef abcdefg abcdefgh a1b2c3 a1b2c3d4
aa123456 iloveyou iloveyou1 princess letmein letmein1 welcome welcome1 welcome123 monkey
dragon football baseball basketball soccer hockey batman superman spiderman starwars
master master123 shadow sunshine trustno1 freedom whatever qazwsx michael jennifer jordan
jordan23 hunter hunter2 ranger buster thomas tigger robert soccer1 harley charlie
charlie1 andrew daniel jessica pepper ginger matrix computer internet secret secret123
login admin admin1 admin123 administrator root toor changeme changeme123 default guest
test test123 testing tester demo demo123 demo1234 user user123 username service
summer winter spring autumn fall2024 summer2024 winter2024 spring2024 summer2025
winter2025 spring2025 summer2026 winter2026 spring2026 january february march april
june july august september october november december monday friday
mustang corvette ferrari porsche mercedes chevrolet camaro yamaha harley1 cowboys
yankees lakers steelers packers eagles patriots dallas chicago boston newyork texas
florida california london paris america usa liberty
love lover loveme lovely loveyou babygirl baby angel angels flower flowers rainbow
butterfly cookie chocolate banana orange apple cheese pizza coffee summer1 sunshine1
hello hello123 hellohello goodluck goodbye hiphop music guitar killer killer1 hacker
pokemon nintendo minecraft fortnite gamer gaming playstation xbox zelda mario
naruto dragonball samsung iphone apple123 google facebook twitter instagram youtube
linkedin microsoft windows linux ubuntu oracle cisco
qwerty12 qwerty1234 q1w2e3r4 q1w2e3r4t5 1qw23e 12qwaszx asdasd asdasdasd qweqwe
qweasd qweasdzxc zxczxc 147258 147258369 159753 159357 741852 741852963 852456
963852741 789456 789456123 456123 456789 147852 258456 135790 246810 13579 24680
abc12345 abcabc aaaaaa aaaaaaaa password1 password12 password123 password1234
passw0rd1 p4ssword p4ssw0rd mypassword yourpassword thepassword newpassword
oldpassword nopassword letmein123 welcome1234 trustno11 access access14 accessdenied
blink182 metallica slipknot nirvana eminem rockyou rocknroll superstar starlight
midnight moonlight sunflower whiskey jasmine jasper maggie molly bailey buddy
daisy lucky luckyone tiger tigers lion lionking eagle1 falcon phoenix wizard
merlin gandalf legend legolas warrior ninja samurai knight dragon1 diamond gold
silver platinum money money123 cash dollar rich million billion success
business company office manager boss employee worker locksmith plumber
plumbing hvac electric electrician handyman contractor construction garage
garagedoor homeservice service123 repair repairs fixit
family family1 friends friend forever forever1 together mother father sister
brother daughter children mommy daddy grandma grandpa jesus jesus1 god godisgood
blessed faith hope heaven christ christian
`;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  LIST.split(/\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
