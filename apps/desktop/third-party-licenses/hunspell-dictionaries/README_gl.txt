Source
======
https://gitlab.com/trasno/hunspell-gl

Readme
======

============================================
Corrector ortográfico Hunspell para o galego
============================================

.. note:: This text is in Galician, as the main target audience of this
          software is expected to speak Galician, but not necessarily English.

Hunspell é unha tecnoloxía que permite desenvolver correctores ortográficos.

Hunspell é a tecnoloxía de corrección ortográfica que se emprega en aplicacións
como LibreOffice, Firefox, Scribus, OpenOffice, Google Chrome, Opera, ou
Evernote. Trátase así mesmo da principal tecnoloxía de corrección ortográfica
dos sistemas GNU/Linux e Mac OS X.

O Proxecto Trasno encárgase actualmente do desenvolvemento do corrector
Hunspell de galego.

Instalación
===========

A continuación fornécense ligazóns para a instalación do corrector nas
diferentes aplicacións e sistemas operativos que permiten unha instalación
sinxela.

Aplicacións:

-   `Firefox <https://addons.mozilla.org/firefox/addon/corrector-de-galego/>`_

-   `LibreOffice <https://extensions.libreoffice.org/en/extensions/show/corrector-ortografico-para-galego>`_

Sistemas operativos e distribucións:

-   `Arch Linux <https://aur.archlinux.org/packages/hunspell-gl/>`_

-   `Debian <https://packages.debian.org/hunspell-gl>`_

-   `Ubuntu <https://packages.ubuntu.com/hunspell-gl>`_

Estes métodos de instalación dependen de terceiros, polo que non podemos
asegurar que permitan instalar a última versión do corrector xusto despois da
súa publicación. Se o método instala unha versión obsoleta do corrector,
informe aos mantedores da aplicación ou do sistema operativo.

Para outras aplicacións ou sistemas operativos que sexan compatíbeis con
correctores baseados en Hunspell, constrúa os ficheiros de Hunspell como se
detalla embaixo (en «Construción») e siga as instrucións oficiais da aplicación
ou sistema operativo para a instalación dun corrector deste tipo.


Normativa
=========

Este corrector asume como modelo oficial para as regras gramaticais: Normas
ortográficas e morfolóxicas do idioma galego, Real Academia Galega / Instituto
da Lingua Galega, 2003.
http://academia.gal/documents/10157/704901/Normas+ortogr%C3%A1ficas+e+morfol%C3%B3xicas+do+idioma+galego.pdf

Sobre a normativa:

-   http://gl.wikipedia.org/wiki/Normativa_oficial_do_galego

-   http://gl.wikipedia.org/wiki/Normas_Ortogr%C3%A1ficas_e_Morfol%C3%B3xicas_do_Idioma_Galego


Lista de cambios
================

No documento ``CHANGELOG.rst`` pode consultarse a lista de cambios introducidos
polas sucesivas versións do corrector.


Construción
===========

Para construír unha parella de ficheiros de Hunspell (:code:`.aff` e
:code:`.dic`):

#.  Instale Python 3.

#.  Cree un entorno virtual de Python e instale nel PyICU e SCons::

        python3 -m venv venv
        . venv/bin/activate
        pip install wheel  # Pode ser necesario para instalar SCons
        pip install SCons PyICU

#.  Execute :code:`scons`.

Isto xerará dous ficheiros, :code:`build/gl.aff` e :code:`build/gl.dic`, que
inclúen as regras ortográficas para os módulos predeterminados do corrector.

Para volver construír o corrector ortográfico despois de cambiar algún
ficheiro, primeiro debe facer limpeza con::

    scons -c

Para obter información detallada sobre como construír un corrector ortográfico
personalizado, con vocabulario non normativo e extensións, execute::

    scons -h

Edicións alternativas
---------------------

As regras de construción de palabras, vocabulario e suxestións están divididas
en varios cartafoles dentro de ``src`` segundo a entidade que as apoia, e
dentro deses cartafoles están en ocasións subdivididas en máis cartafoles.

Ao construír unha parella de ficheiros de Hunspell con ``scons``, podemos usar
parámetros para determinar os cartafoles de ``src`` a partir dos cales se
xerarán os ficheiros, permitindo a calquera construír un corrector a medida.

Estas son algunhas das edicións que se poden construír, e a orde necesaria para
construílas:

-   Edición predeterminada (exclúe os códigos ISO, o VOLGa, e o vocabulario
    tolerado do DRAG)::

        scons

-   Edición estrita (só co vocabulario recomendado polo DRAG)::

        scons dic=norma,rag/gl/abreviaturas,rag/gl/correcto

-   Edición completa::

        TODO=$(ls src | grep -v / | xargs echo | sed 's/ /,/g') \
        scons aff=$TODO dic=$TODO rep=$TODO


Comprobación
============

Cun dicionario construído a partir das fontes con ``scons``, pode comprobar
como o dicionario construído a partir das fontes se comporta ante distintas
palabras usando o programa da liña de ordes ``hunspell`` nun terminal como se
indica a continuación.

A seguinte orde só lista as palabras que o dicionario construído considera
correctas::

    echo <palabra1> [<palabra2> …] | hunspell -d build/gl -G

Tamén pode listar só as incorrectas::

    echo <palabra1> [<palabra2> …] | hunspell -d build/gl -l

Pode consultar as suxestións para unha palabra incorrecta coa seguinte orde::

    echo <palabra1> [<palabra2> …] | hunspell -d build/gl

Para consultar os detalles sobre unha palabra considerada como correcta, use a
seguinte orde::

    echo <palabra1> [<palabra2> …] | hunspell -d build/gl -m


Colaboración
============

-   Á hora de engadir vocabulario, buscar unha fonte que o apoie para decidir
    en que módulo definir o vocabulario:

    #.  Dicionarios:

        #.  ``rag/gl``: `dicionario da Real Academia Galega`_

            .. _dicionario da Real Academia Galega: https://academia.gal/dicionario

        #.  ``xunta/digalego``: Digalego_

            .. _Digalego: https://digalego.xunta.gal/gl/

        #.  ``estraviz``: Estraviz_

            .. _Estraviz: https://estraviz.org/

        #.  `Dicionario de dicionarios`_:

            .. _Dicionario de dicionarios: https://ilg.usc.gal/ddd/index.php

    #.  Bancos de terminoloxía:

        #.  ``tergal``: `TERGAL`_

            .. _TERGAL: http://bernal.cirp.gal/ords/f?p=TERGAL:6

        #.  ``usc/buscatermos``: bUSCatermos_

            .. _bUSCatermos: https://aplicacions.usc.es/buscatermos/publica/index.htm

    #.  Glosarios:

        #.  ``usc/arqueoloxía``: `Léxico de arqueoloxía (castelán-galego)`_

            .. _Léxico de arqueoloxía (castelán-galego): https://www.usc.gal/gl/servizos/snl/terminoloxia/descargas/arqueo.html

        #.  ``aetg/digatic``: DiGaTIC_

            .. _DiGaTIC: http://www.digatic.org/gl

        #.  ``intef/gtm``: `glosario técnico multimedia`_

            .. _glosario técnico multimedia: http://ares.cnice.mec.es/gtm/web/index_gl.php

        #.  ``ige``: `vocabulario estatístico`_

            .. _vocabulario estatístico: http://www.ige.eu/web/mostrar_paxina.jsp?paxina=003006&idioma=gl

        #.  ``trasno``: `glosario do Proxecto Trasno`_

            .. _glosario do Proxecto Trasno: http://termos.trasno.gal/

    #.  Outras fontes:

        #.  ``galaxia/xlfg-gl-es``: `dicionario galego-castelán`_

            .. _dicionario galego-castelán: https://books.google.es/books?id=ToQKZXuI6vgC

        #.  ``clg/dubidas``: `Dúbidas do galego`_

            .. _Dúbidas do galego: https://dubidasdogalego.wordpress.com

    #.  Proxectos comunitarios:

        #.  ``wiktionary/gl``: Galizionario_

            .. _Galizionario: https://gl.wiktionary.org/wiki/Wiktionary:P%C3%A1xina_principal

        #.  ``wikipedia/gl``: Galipedia_

            .. _Galipedia: https://gl.wikipedia.org/wiki/Portada

    En caso de non atopar ningunha fonte que o apoie, pode engadirse o
    vocabulario con ``comunidade`` como fonte.

    É posible definir un termo en máis dun módulo. A única excepción é
    ``comunidade``, onde só ten sentido definir vocabulario que non ten cabida
    en ningún outro módulo.

-   Antes de publicar unha nova versión, repasar a lista de cambios coas
    versións vella e nova do corrector, para asegurarse de que as palabras e
    suxestións engadidas e retiradas efectivamente o foron.

-   Para comprobar automaticamente se o módulo ``rag/gl/correcto.dic`` necesita
    cambios a raíz de actualizacións do dicionario da Real Academia Galega,
    seguir as instrucións de ``utils/generator/README.rst``.


Autores e colaboradores
=======================

© 2006-2009 Mancomún-CESGA

© 2009-2011 Fundación para o Fomento da Calidade Industrial e Desenvolvemento
Tecnolóxico de Galicia, Xunta de Galicia - Consellería de Economía e Industria

© 2011-2023 Proxecto Trasno

Mantido por Proxecto Trasno (http://trasno.gal) baixo a coordinación de Antón
Méixome.

Desde que existe este recurso, e o seu predecesor, ispell, moita xente e varias
organizacións participaron no seu desenvolvemento e mantemento. Entre eles,
debemos salientar as achegas de:

-   André Ventas e Ramón Flores (para ispell). Ata 2003.

-   Xavier Gómez Guinovart, para Imaxin Software e este para Mancomún (primeira
    versión version hunspell, dicionario e regras básicas). 2006.

-   Mancomún, Iniciativa Galega para Software Libre, para Xunta de Galicia (Mar
    Castro, regras formais e dicionario; Francisco Rial, extensión oxt).
    2006-2008.

-   Proxecto Trasno (Miguel Solla, regras avanzadas e dicionario). 2009-2010.

-   Proxecto Trasno (Adrián Chaves, regras novas e reestruturación do código
    para a compilación, dicionario). 2010-2013.

Desde o comezo e hoxe en día as fontes principais para o dicionario son os
públicos Vocabulario Ortográfico da Lingua Galega (VOLGa) e o Dicionario da
Real Academia Galega en liña e as súas evolucións no tempos. Debemos
agradecerlle ao ILGA (en concreto a Antón Santamarina) o seu permiso explícito
para poder realizar un dicionario con licenza GPL a partir dos seus recursos
lingüísticos.

-   VOLG(a) Santamarina Fernández, Antón e González González, Manuel (coord.).
    Real Academia Galega / Instituto da Lingua Galega, 2004.
    http://www.realacademiagalega.org/volga/.

O dicionario tamén se alimenta tanto das suxestións dos usuarios como de recursos
libres descontinuados coma motor de suxestións de erros frecuentes Benposto ou
suxestións de corrección da Wikipedia en galego.

Unha descrición técnica sobre o comportamento morfolóxico e sintáctico escrita
por Miguel Solla pódese ver en:

-   Núm. 1 da revista Linguamática (ISSN: 1647-0818)
    http://linguamatica.com/index.php/linguamatica/article/view/13


Licenza
=======

Este ficheiro é parte de Hunspell-gl.

.. code-block::

    Hunspell-gl is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Hunspell-gl is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with Foobar.  If not, see <http://www.gnu.org/licenses/>.

O corrector está publicado nos termos da licenca GPLv3 (desde 2010, antes
GPLv2 e GPLv1). Achégase o ficheiro «license-gl.txt», ou «license.txt» para
consultar o texto completo da versión orixinal da licenza.

License
=======

                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <http://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The GNU General Public License is a free, copyleft license for
software and other kinds of works.

  The licenses for most software and other practical works are designed
to take away your freedom to share and change the works.  By contrast,
the GNU General Public License is intended to guarantee your freedom to
share and change all versions of a program--to make sure it remains free
software for all its users.  We, the Free Software Foundation, use the
GNU General Public License for most of our software; it applies also to
any other work released this way by its authors.  You can apply it to
your programs, too.

  When we speak of free software, we are referring to freedom, not
price.  Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
them if you wish), that you receive source code or can get it if you
want it, that you can change the software or use pieces of it in new
free programs, and that you know you can do these things.

  To protect your rights, we need to prevent others from denying you
these rights or asking you to surrender the rights.  Therefore, you have
certain responsibilities if you distribute copies of the software, or if
you modify it: responsibilities to respect the freedom of others.

  For example, if you distribute copies of such a program, whether
gratis or for a fee, you must pass on to the recipients the same
freedoms that you received.  You must make sure that they, too, receive
or can get the source code.  And you must show them these terms so they
know their rights.

  Developers that use the GNU GPL protect your rights with two steps:
(1) assert copyright on the software, and (2) offer you this License
giving you legal permission to copy, distribute and/or modify it.

  For the developers' and authors' protection, the GPL clearly explains
that there is no warranty for this free software.  For both users' and
authors' sake, the GPL requires that modified versions be marked as
changed, so that their problems will not be attributed erroneously to
authors of previous versions.

  Some devices are designed to deny users access to install or run
modified versions of the software inside them, although the manufacturer
can do so.  This is fundamentally incompatible with the aim of
protecting users' freedom to change the software.  The systematic
pattern of such abuse occurs in the area of products for individuals to
use, which is precisely where it is most unacceptable.  Therefore, we
have designed this version of the GPL to prohibit the practice for those
products.  If such problems arise substantially in other domains, we
stand ready to extend this provision to those domains in future versions
of the GPL, as needed to protect the freedom of users.

  Finally, every program is threatened constantly by software patents.
States should not allow patents to restrict development and use of
software on general-purpose computers, but in those that do, we wish to
avoid the special danger that patents applied to a free program could
make it effectively proprietary.  To prevent this, the GPL assures that
patents cannot be used to render the program non-free.

  The precise terms and conditions for copying, distribution and
modification follow.

                       TERMS AND CONDITIONS

  0. Definitions.

  "This License" refers to version 3 of the GNU General Public License.

  "Copyright" also means copyright-like laws that apply to other kinds of
works, such as semiconductor masks.

  "The Program" refers to any copyrightable work licensed under this
License.  Each licensee is addressed as "you".  "Licensees" and
"recipients" may be individuals or organizations.

  To "modify" a work means to copy from or adapt all or part of the work
in a fashion requiring copyright permission, other than the making of an
exact copy.  The resulting work is called a "modified version" of the
earlier work or a work "based on" the earlier work.

  A "covered work" means either the unmodified Program or a work based
on the Program.

  To "propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy.  Propagation includes copying,
distribution (with or without modification), making available to the
public, and in some countries other activities as well.

  To "convey" a work means any kind of propagation that enables other
parties to make or receive copies.  Mere interaction with a user through
a computer network, with no transfer of a copy, is not conveying.

  An interactive user interface displays "Appropriate Legal Notices"
to the extent that it includes a convenient and prominently visible
feature that (1) displays an appropriate copyright notice, and (2)
tells the user that there is no warranty for the work (except to the
extent that warranties are provided), that licensees may convey the
work under this License, and how to view a copy of this License.  If
the interface presents a list of user commands or options, such as a
menu, a prominent item in the list meets this criterion.

  1. Source Code.

  The "source code" for a work means the preferred form of the work
for making modifications to it.  "Object code" means any non-source
form of a work.

  A "Standard Interface" means an interface that either is an official
standard defined by a recognized standards body, or, in the case of
interfaces specified for a particular programming language, one that
is widely used among developers working in that language.

  The "System Libraries" of an executable work include anything, other
than the work as a whole, that (a) is included in the normal form of
packaging a Major Component, but which is not part of that Major
Component, and (b) serves only to enable use of the work with that
Major Component, or to implement a Standard Interface for which an
implementation is available to the public in source code form.  A
"Major Component", in this context, means a major essential component
(kernel, window system, and so on) of the specific operating system
(if any) on which the executable work runs, or a compiler used to
produce the work, or an object code interpreter used to run it.

  The "Corresponding Source" for a work in object code form means all
the source code needed to generate, install, and (for an executable
work) run the object code and to modify the work, including scripts to
control those activities.  However, it does not include the work's
System Libraries, or general-purpose tools or generally available free
programs which are used unmodified in performing those activities but
which are not part of the work.  For example, Corresponding Source
includes interface definition files associated with source files for
the work, and the source code for shared libraries and dynamically
linked subprograms that the work is specifically designed to require,
such as by intimate data communication or control flow between those
subprograms and other parts of the work.

  The Corresponding Source need not include anything that users
can regenerate automatically from other parts of the Corresponding
Source.

  The Corresponding Source for a work in source code form is that
same work.

  2. Basic Permissions.

  All rights granted under this License are granted for the term of
copyright on the Program, and are irrevocable provided the stated
conditions are met.  This License explicitly affirms your unlimited
permission to run the unmodified Program.  The output from running a
covered work is covered by this License only if the output, given its
content, constitutes a covered work.  This License acknowledges your
rights of fair use or other equivalent, as provided by copyright law.

  You may make, run and propagate covered works that you do not
convey, without conditions so long as your license otherwise remains
in force.  You may convey covered works to others for the sole purpose
of having them make modifications exclusively for you, or provide you
with facilities for running those works, provided that you comply with
the terms of this License in conveying all material for which you do
not control copyright.  Those thus making or running the covered works
for you must do so exclusively on your behalf, under your direction
and control, on terms that prohibit them from making any copies of
your copyrighted material outside their relationship with you.

  Conveying under any other circumstances is permitted solely under
the conditions stated below.  Sublicensing is not allowed; section 10
makes it unnecessary.

  3. Protecting Users' Legal Rights From Anti-Circumvention Law.

  No covered work shall be deemed part of an effective technological
measure under any applicable law fulfilling obligations under article
11 of the WIPO copyright treaty adopted on 20 December 1996, or
similar laws prohibiting or restricting circumvention of such
measures.

  When you convey a covered work, you waive any legal power to forbid
circumvention of technological measures to the extent such circumvention
is effected by exercising rights under this License with respect to
the covered work, and you disclaim any intention to limit operation or
modification of the work as a means of enforcing, against the work's
users, your or third parties' legal rights to forbid circumvention of
technological measures.

  4. Conveying Verbatim Copies.

  You may convey verbatim copies of the Program's source code as you
receive it, in any medium, provided that you conspicuously and
appropriately publish on each copy an appropriate copyright notice;
keep intact all notices stating that this License and any
non-permissive terms added in accord with section 7 apply to the code;
keep intact all notices of the absence of any warranty; and give all
recipients a copy of this License along with the Program.

  You may charge any price or no price for each copy that you convey,
and you may offer support or warranty protection for a fee.

  5. Conveying Modified Source Versions.

  You may convey a work based on the Program, or the modifications to
produce it from the Program, in the form of source code under the
terms of section 4, provided that you also meet all of these conditions:

    a) The work must carry prominent notices stating that you modified
    it, and giving a relevant date.

    b) The work must carry prominent notices stating that it is
    released under this License and any conditions added under section
    7.  This requirement modifies the requirement in section 4 to
    "keep intact all notices".

    c) You must license the entire work, as a whole, under this
    License to anyone who comes into possession of a copy.  This
    License will therefore apply, along with any applicable section 7
    additional terms, to the whole of the work, and all its parts,
    regardless of how they are packaged.  This License gives no
    permission to license the work in any other way, but it does not
    invalidate such permission if you have separately received it.

    d) If the work has interactive user interfaces, each must display
    Appropriate Legal Notices; however, if the Program has interactive
    interfaces that do not display Appropriate Legal Notices, your
    work need not make them do so.

  A compilation of a covered work with other separate and independent
works, which are not by their nature extensions of the covered work,
and which are not combined with it such as to form a larger program,
in or on a volume of a storage or distribution medium, is called an
"aggregate" if the compilation and its resulting copyright are not
used to limit the access or legal rights of the compilation's users
beyond what the individual works permit.  Inclusion of a covered work
in an aggregate does not cause this License to apply to the other
parts of the aggregate.

  6. Conveying Non-Source Forms.

  You may convey a covered work in object code form under the terms
of sections 4 and 5, provided that you also convey the
machine-readable Corresponding Source under the terms of this License,
in one of these ways:

    a) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by the
    Corresponding Source fixed on a durable physical medium
    customarily used for software interchange.

    b) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by a
    written offer, valid for at least three years and valid for as
    long as you offer spare parts or customer support for that product
    model, to give anyone who possesses the object code either (1) a
    copy of the Corresponding Source for all the software in the
    product that is covered by this License, on a durable physical
    medium customarily used for software interchange, for a price no
    more than your reasonable cost of physically performing this
    conveying of source, or (2) access to copy the
    Corresponding Source from a network server at no charge.

    c) Convey individual copies of the object code with a copy of the
    written offer to provide the Corresponding Source.  This
    alternative is allowed only occasionally and noncommercially, and
    only if you received the object code with such an offer, in accord
    with subsection 6b.

    d) Convey the object code by offering access from a designated
    place (gratis or for a charge), and offer equivalent access to the
    Corresponding Source in the same way through the same place at no
    further charge.  You need not require recipients to copy the
    Corresponding Source along with the object code.  If the place to
    copy the object code is a network server, the Corresponding Source
    may be on a different server (operated by you or a third party)
    that supports equivalent copying facilities, provided you maintain
    clear directions next to the object code saying where to find the
    Corresponding Source.  Regardless of what server hosts the
    Corresponding Source, you remain obligated to ensure that it is
    available for as long as needed to satisfy these requirements.

    e) Convey the object code using peer-to-peer transmission, provided
    you inform other peers where the object code and Corresponding
    Source of the work are being offered to the general public at no
    charge under subsection 6d.

  A separable portion of the object code, whose source code is excluded
from the Corresponding Source as a System Library, need not be
included in conveying the object code work.

  A "User Product" is either (1) a "consumer product", which means any
tangible personal property which is normally used for personal, family,
or household purposes, or (2) anything designed or sold for incorporation
into a dwelling.  In determining whether a product is a consumer product,
doubtful cases shall be resolved in favor of coverage.  For a particular
product received by a particular user, "normally used" refers to a
typical or common use of that class of product, regardless of the status
of the particular user or of the way in which the particular user
actually uses, or expects or is expected to use, the product.  A product
is a consumer product regardless of whether the product has substantial
commercial, industrial or non-consumer uses, unless such uses represent
the only significant mode of use of the product.

  "Installation Information" for a User Product means any methods,
procedures, authorization keys, or other information required to install
and execute modified versions of a covered work in that User Product from
a modified version of its Corresponding Source.  The information must
suffice to ensure that the continued functioning of the modified object
code is in no case prevented or interfered with solely because
modification has been made.

  If you convey an object code work under this section in, or with, or
specifically for use in, a User Product, and the conveying occurs as
part of a transaction in which the right of possession and use of the
User Product is transferred to the recipient in perpetuity or for a
fixed term (regardless of how the transaction is characterized), the
Corresponding Source conveyed under this section must be accompanied
by the Installation Information.  But this requirement does not apply
if neither you nor any third party retains the ability to install
modified object code on the User Product (for example, the work has
been installed in ROM).

  The requirement to provide Installation Information does not include a
requirement to continue to provide support service, warranty, or updates
for a work that has been modified or installed by the recipient, or for
the User Product in which it has been modified or installed.  Access to a
network may be denied when the modification itself materially and
adversely affects the operation of the network or violates the rules and
protocols for communication across the network.

  Corresponding Source conveyed, and Installation Information provided,
in accord with this section must be in a format that is publicly
documented (and with an implementation available to the public in
source code form), and must require no special password or key for
unpacking, reading or copying.

  7. Additional Terms.

  "Additional permissions" are terms that supplement the terms of this
License by making exceptions from one or more of its conditions.
Additional permissions that are applicable to the entire Program shall
be treated as though they were included in this License, to the extent
that they are valid under applicable law.  If additional permissions
apply only to part of the Program, that part may be used separately
under those permissions, but the entire Program remains governed by
this License without regard to the additional permissions.

  When you convey a copy of a covered work, you may at your option
remove any additional permissions from that copy, or from any part of
it.  (Additional permissions may be written to require their own
removal in certain cases when you modify the work.)  You may place
additional permissions on material, added by you to a covered work,
for which you have or can give appropriate copyright permission.

  Notwithstanding any other provision of this License, for material you
add to a covered work, you may (if authorized by the copyright holders of
that material) supplement the terms of this License with terms:

    a) Disclaiming warranty or limiting liability differently from the
    terms of sections 15 and 16 of this License; or

    b) Requiring preservation of specified reasonable legal notices or
    author attributions in that material or in the Appropriate Legal
    Notices displayed by works containing it; or

    c) Prohibiting misrepresentation of the origin of that material, or
    requiring that modified versions of such material be marked in
    reasonable ways as different from the original version; or

    d) Limiting the use for publicity purposes of names of licensors or
    authors of the material; or

    e) Declining to grant rights under trademark law for use of some
    trade names, trademarks, or service marks; or

    f) Requiring indemnification of licensors and authors of that
    material by anyone who conveys the material (or modified versions of
    it) with contractual assumptions of liability to the recipient, for
    any liability that these contractual assumptions directly impose on
    those licensors and authors.

  All other non-permissive additional terms are considered "further
restrictions" within the meaning of section 10.  If the Program as you
received it, or any part of it, contains a notice stating that it is
governed by this License along with a term that is a further
restriction, you may remove that term.  If a license document contains
a further restriction but permits relicensing or conveying under this
License, you may add to a covered work material governed by the terms
of that license document, provided that the further restriction does
not survive such relicensing or conveying.

  If you add terms to a covered work in accord with this section, you
must place, in the relevant source files, a statement of the
additional terms that apply to those files, or a notice indicating
where to find the applicable terms.

  Additional terms, permissive or non-permissive, may be stated in the
form of a separately written license, or stated as exceptions;
the above requirements apply either way.

  8. Termination.

  You may not propagate or modify a covered work except as expressly
provided under this License.  Any attempt otherwise to propagate or
modify it is void, and will automatically terminate your rights under
this License (including any patent licenses granted under the third
paragraph of section 11).

  However, if you cease all violation of this License, then your
license from a particular copyright holder is reinstated (a)
provisionally, unless and until the copyright holder explicitly and
finally terminates your license, and (b) permanently, if the copyright
holder fails to notify you of the violation by some reasonable means
prior to 60 days after the cessation.

  Moreover, your license from a particular copyright holder is
reinstated permanently if the copyright holder notifies you of the
violation by some reasonable means, this is the first time you have
received notice of violation of this License (for any work) from that
copyright holder, and you cure the violation prior to 30 days after
your receipt of the notice.

  Termination of your rights under this section does not terminate the
licenses of parties who have received copies or rights from you under
this License.  If your rights have been terminated and not permanently
reinstated, you do not qualify to receive new licenses for the same
material under section 10.

  9. Acceptance Not Required for Having Copies.

  You are not required to accept this License in order to receive or
run a copy of the Program.  Ancillary propagation of a covered work
occurring solely as a consequence of using peer-to-peer transmission
to receive a copy likewise does not require acceptance.  However,
nothing other than this License grants you permission to propagate or
modify any covered work.  These actions infringe copyright if you do
not accept this License.  Therefore, by modifying or propagating a
covered work, you indicate your acceptance of this License to do so.

  10. Automatic Licensing of Downstream Recipients.

  Each time you convey a covered work, the recipient automatically
receives a license from the original licensors, to run, modify and
propagate that work, subject to this License.  You are not responsible
for enforcing compliance by third parties with this License.

  An "entity transaction" is a transaction transferring control of an
organization, or substantially all assets of one, or subdividing an
organization, or merging organizations.  If propagation of a covered
work results from an entity transaction, each party to that
transaction who receives a copy of the work also receives whatever
licenses to the work the party's predecessor in interest had or could
give under the previous paragraph, plus a right to possession of the
Corresponding Source of the work from the predecessor in interest, if
the predecessor has it or can get it with reasonable efforts.

  You may not impose any further restrictions on the exercise of the
rights granted or affirmed under this License.  For example, you may
not impose a license fee, royalty, or other charge for exercise of
rights granted under this License, and you may not initiate litigation
(including a cross-claim or counterclaim in a lawsuit) alleging that
any patent claim is infringed by making, using, selling, offering for
sale, or importing the Program or any portion of it.

  11. Patents.

  A "contributor" is a copyright holder who authorizes use under this
License of the Program or a work on which the Program is based.  The
work thus licensed is called the contributor's "contributor version".

  A contributor's "essential patent claims" are all patent claims
owned or controlled by the contributor, whether already acquired or
hereafter acquired, that would be infringed by some manner, permitted
by this License, of making, using, or selling its contributor version,
but do not include claims that would be infringed only as a
consequence of further modification of the contributor version.  For
purposes of this definition, "control" includes the right to grant
patent sublicenses in a manner consistent with the requirements of
this License.

  Each contributor grants you a non-exclusive, worldwide, royalty-free
patent license under the contributor's essential patent claims, to
make, use, sell, offer for sale, import and otherwise run, modify and
propagate the contents of its contributor version.

  In the following three paragraphs, a "patent license" is any express
agreement or commitment, however denominated, not to enforce a patent
(such as an express permission to practice a patent or covenant not to
sue for patent infringement).  To "grant" such a patent license to a
party means to make such an agreement or commitment not to enforce a
patent against the party.

  If you convey a covered work, knowingly relying on a patent license,
and the Corresponding Source of the work is not available for anyone
to copy, free of charge and under the terms of this License, through a
publicly available network server or other readily accessible means,
then you must either (1) cause the Corresponding Source to be so
available, or (2) arrange to deprive yourself of the benefit of the
patent license for this particular work, or (3) arrange, in a manner
consistent with the requirements of this License, to extend the patent
license to downstream recipients.  "Knowingly relying" means you have
actual knowledge that, but for the patent license, your conveying the
covered work in a country, or your recipient's use of the covered work
in a country, would infringe one or more identifiable patents in that
country that you have reason to believe are valid.

  If, pursuant to or in connection with a single transaction or
arrangement, you convey, or propagate by procuring conveyance of, a
covered work, and grant a patent license to some of the parties
receiving the covered work authorizing them to use, propagate, modify
or convey a specific copy of the covered work, then the patent license
you grant is automatically extended to all recipients of the covered
work and works based on it.

  A patent license is "discriminatory" if it does not include within
the scope of its coverage, prohibits the exercise of, or is
conditioned on the non-exercise of one or more of the rights that are
specifically granted under this License.  You may not convey a covered
work if you are a party to an arrangement with a third party that is
in the business of distributing software, under which you make payment
to the third party based on the extent of your activity of conveying
the work, and under which the third party grants, to any of the
parties who would receive the covered work from you, a discriminatory
patent license (a) in connection with copies of the covered work
conveyed by you (or copies made from those copies), or (b) primarily
for and in connection with specific products or compilations that
contain the covered work, unless you entered into that arrangement,
or that patent license was granted, prior to 28 March 2007.

  Nothing in this License shall be construed as excluding or limiting
any implied license or other defenses to infringement that may
otherwise be available to you under applicable patent law.

  12. No Surrender of Others' Freedom.

  If conditions are imposed on you (whether by court order, agreement or
otherwise) that contradict the conditions of this License, they do not
excuse you from the conditions of this License.  If you cannot convey a
covered work so as to satisfy simultaneously your obligations under this
License and any other pertinent obligations, then as a consequence you may
not convey it at all.  For example, if you agree to terms that obligate you
to collect a royalty for further conveying from those to whom you convey
the Program, the only way you could satisfy both those terms and this
License would be to refrain entirely from conveying the Program.

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine any covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work, and to convey the resulting work.  The terms of this
License will continue to apply to the part which is the covered work,
but the special requirements of the GNU Affero General Public License,
section 13, concerning interaction through a network will apply to the
combination as such.

  14. Revised Versions of this License.

  The Free Software Foundation may publish revised and/or new versions of
the GNU General Public License from time to time.  Such new versions will
be similar in spirit to the present version, but may differ in detail to
address new problems or concerns.

  Each version is given a distinguishing version number.  If the
Program specifies that a certain numbered version of the GNU General
Public License "or any later version" applies to it, you have the
option of following the terms and conditions either of that numbered
version or of any later version published by the Free Software
Foundation.  If the Program does not specify a version number of the
GNU General Public License, you may choose any version ever published
by the Free Software Foundation.

  If the Program specifies that a proxy can decide which future
versions of the GNU General Public License can be used, that proxy's
public statement of acceptance of a version permanently authorizes you
to choose that version for the Program.

  Later license versions may give you additional or different
permissions.  However, no additional obligations are imposed on any
author or copyright holder as a result of your choosing to follow a
later version.

  15. Disclaimer of Warranty.

  THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY
APPLICABLE LAW.  EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT
HOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY
OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM
IS WITH YOU.  SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF
ALL NECESSARY SERVICING, REPAIR OR CORRECTION.

  16. Limitation of Liability.

  IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MODIFIES AND/OR CONVEYS
THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY
GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE
USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS OF
DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD
PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS),
EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF
SUCH DAMAGES.

  17. Interpretation of Sections 15 and 16.

  If the disclaimer of warranty and limitation of liability provided
above cannot be given local legal effect according to their terms,
reviewing courts shall apply local law that most closely approximates
an absolute waiver of all civil liability in connection with the
Program, unless a warranty or assumption of liability accompanies a
copy of the Program in return for a fee.

                     END OF TERMS AND CONDITIONS

            How to Apply These Terms to Your New Programs

  If you develop a new program, and you want it to be of the greatest
possible use to the public, the best way to achieve this is to make it
free software which everyone can redistribute and change under these terms.

  To do so, attach the following notices to the program.  It is safest
to attach them to the start of each source file to most effectively
state the exclusion of warranty; and each file should have at least
the "copyright" line and a pointer to where the full notice is found.

    <one line to give the program's name and a brief idea of what it does.>
    Copyright (C) <year>  <name of author>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

Also add information on how to contact you by electronic and paper mail.

  If the program does terminal interaction, make it output a short
notice like this when it starts in an interactive mode:

    <program>  Copyright (C) <year>  <name of author>
    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
    This is free software, and you are welcome to redistribute it
    under certain conditions; type `show c' for details.

The hypothetical commands `show w' and `show c' should show the appropriate
parts of the General Public License.  Of course, your program's commands
might be different; for a GUI interface, you would use an "about box".

  You should also get your employer (if you work as a programmer) or school,
if any, to sign a "copyright disclaimer" for the program, if necessary.
For more information on this, and how to apply and follow the GNU GPL, see
<http://www.gnu.org/licenses/>.

  The GNU General Public License does not permit incorporating your program
into proprietary programs.  If your program is a subroutine library, you
may consider it more useful to permit linking proprietary applications with
the library.  If this is what you want to do, use the GNU Lesser General
Public License instead of this License.  But first, please read
<http://www.gnu.org/philosophy/why-not-lgpl.html>.

License (gl)
============

This is an unofficial translation of the GNU General Public License into galician. It was not published by
the Free Software Foundation, and does not legally state the distribution terms for software that uses the
GNU GPL—only the original English text of the GNU GPL does that. However, we hope that this translation
will help galician speakers understand the GNU GPL better.

﻿A presente é unha tradución non oficial da licenza pública xeral de GNU ao galego. Non foi publicada pola
Fundación para o Software Libre nin estabelece legalmente os termos de difusión para o software que se rexa
pola licenza pública xeral de GNU (GNU GPL, polas súas siglas en inglés); a única que o fai é a versión
orixinal en inglés da GNU GPL. No entanto, esperamos que esta tradución axude as e os galegofalantes a
comprender mellor a GNU GPL.

LICENZA PÚBLICA XERAL DE GNU

Versión 3, 29 de xuño de 2007

Copyright © 2007 Free Software Foundation, Inc <http://fsf.org/> .

Autorízase a reprodución e difusión das copias do presente documento de licenza, pero prohíbese a
modificación de calquera das súas partes.

Preámbulo

A licenza pública xeral de GNU (GNU GPL, polas súas siglas en inglés) é unha licenza libre e gratuíta con
dereito de copia para software (soporte lóxico) e outros tipos de obras.

As licenzas para a maioría do software e outras obras de índole práctica están deseñadas para privar ás
persoas da liberdade para difundir e modificar as obras. Pola contra, a licenza pública xeral de GNU garante
a libre distribución e modificación de todas as versións dun programa, co fin de asegurarlle a dita liberdade
a todas as persoas usuarias. Na Fundación para o Software Libre utilizamos a Licenza Pública Xeneral de GNU
para a maioría do noso software; tamén se lle aplica a calquera outra obra publicada desta maneira polos seus
autores ou autoras. Vostede tamén pode aplicala aos seus programas.

Cando falamos de software libre, referímonos á liberdade, non ao prezo. As nosas licenzas públicas xerais
están deseñadas para garantirlle a vostede a liberdade de distribuír copias de software libre (e cobrar por
elas, se así o desexa), obter o código fonte, ou ter a posibilidade de obtelo, modificar o software ou
utilizar partes del en novos programas libres, e saber que pode facer estas cousas.

Para protexer os seus dereitos, necesitamos evitar que outras persoas ou entidades lle neguen estes dereitos
ou lle pidan que renuncie a eles. Por tanto, no caso de que vostede distribúa ou modifique este software,
terá certas responsabilidades co fin de garantir a liberdade de uso.

Por exemplo, se vostede distribúe copias dun programa desta natureza, xa sexa de forma gratuíta ou a cambio
de diñeiro, debe estender ás persoas destinatarias do software (soporte lóxico) as mesmas liberdades que lle
foron outorgadas a vostede. Debe asegurarse de que  tamén reciban ou teñan a posibilidade de obter o código
fonte. E debe mostrarlles os presentes termos co fin de que coñezan os seus dereitos.

As persoas ou entidades desenvolvedoras que utilizan a GNU GPL seguen dous pasos para protexer os dereitos
que vostede recibe: (1) declarar os dereitos de autoría do software, e (2) ofrecerlle esta licenza para que
vostede poida copiar, distribuír e/ou modificar o software legalmente.

Para protexer o desenvolvemento e a autoría, a GPL explica claramente que non se ofrecen garantías por este
software libre. Polo ben do público usuario e da protección da autoría, a GPL esixe que as versións modificadas
se identifiquen como tales, de modo que os problemas que poidan conter estas versións non se lles atribúan
erroneamente ás persoas desenvolvedoras  de versións anteriores.

Existen algúns dispositivos deseñados para negarlles ás persoas usuarias o acceso para instalar ou executar
versións modificadas do software que conteñen, mentres que a industria pode facelo. Isto é esencialmente
incompatíbel co obxectivo de protexer a liberdade das persoas usuarias para modificar o software. O patrón
sistemático de tal abuso dáse na área de produtos para o uso por parte de persoas a nivel individual,
precisamente unha área na cal se volve máis inaceptábel. Por tanto, deseñamos esta versión da GPL co fin de
prohibir a práctica en tales produtos. No caso de que eses problemas xurdisen noutras esferas, existe pola
nosa parte unha vontade de atender a este tipo de casos en futuras versións da GPL, segundo se requira para
protexer a liberdade das persoas usuarias.

Por último, todos os programas se ven ameazados constantemente por patentes de software. Os estados non
deberían permitirlles ás patentes restrinxir o desenvolvemento e o uso de software en computadores para fins
xerais, pero, no caso de que isto suceda, desexamos evitar o risco especial de que as patentes que se lle
apliquen a un programa libre efectivamente outorguen tal exclusividade. Para logralo, a GPL garante a
imposibilidade do uso das patentes para apropiarse dun programa e restrinxir devandita liberdade.

A continuación, inclúense os termos e condicións particulares para a reprodución, distribución e
modificación do software.

TERMOS E E CONDICIÓNS

0. Definicións

Por "licenza" enténdese a versión 3 da licenza pública xeral de GNU.

O termo "copyright" (dereitos de autoría) tamén se estende ás leis que protexen estes dereitos para outros
tipos de obras, tales como deseños de circuítos integrados sobre placas semicondutoras.

Por "programa" enténdese calquera obra incluída nesta licenza sobre a que se poidan exercer dereitos de
autoría. Para referirnos a cada persoa licenciataria, utilizamos o termo "vostede". As persoas licenciatarias
ou destinatarias poden ser persoas ou organizacións.

Por modificar unha obra enténdese o proceso de copiar ou adaptar unha obra en forma parcial ou total dun
modo que requira autorización de copyright e que non sexa a reprodución dunha copia exacta. A obra resultante
é unha versión modificada da obra anterior ou unha obra baseada na a obra anterior.

Por obra cuberta enténdese o programa sen modificacións ou unha obra baseada no programa.

Por propagar unha obra enténdese calquera acción sobre ela que, no caso de non ter autorización, puidese
implicar responsabilidade, xa sexa de forma directa ou indirecta, de infrinxir as leis de dereitos de autoría
aplicábeis, salvo que tal acción se realice nun computador ou se modifique unha copia privada. A propagación
inclúe a reprodución, distribución (con ou sen modificacións), divulgación e, nalgúns países, outras
actividades tamén.

Por transmitir unha obra enténdese calquera tipo de propagación que lle permita a unha terceira persoa ou
entidade facer ou recibir copias. A mera interacción cunha persoa usuaria a través dunha rede informática,
cando non se transfire unha copia, non se considera unha transmisión.

Unha interface de persoa usuaria interactiva mostra avisos legais apropiados na medida en que, dun modo
práctico e ben visíbel, (1) mostre un aviso de copyright apropiado e (2) informe a persoa usuaria de que non
se ofrecen garantías pola obra (salvante que efectivamente se ofrezan garantías) e que as persoas licenciatarias
poden transmitir a obra conforme as disposicións desta licenza, ademais de mostrar a forma en que se pode
consultar unha copia desta licenza. Se a interface presenta unha lista de comandos da persoa usuaria ou
opcións, tales como un menú, a lista debe incluír un ítem visíbel que cumpra con este criterio.


1. Código fonte

O código fonte dunha obra é o formato preferido da obra para realizar modificacións nela. Por código obxecto
enténdese calquera formato dunha obra que non sexa código fonte.

Unha interface estándar é unha interface que pode ser unha norma oficial, segundo o defina un organismo de
normas recoñecido, ou ben, no caso de interfaces específicas para unha linguaxe de programación particular,
unha interface de uso xeneralizado entre as persoas desenvolvedoras que traballan con esa linguaxe.

As bibliotecas de sistema dunha obra executábel comprenden calquera cousa, non sendo a obra na súa totalidade,
que (a) inclúa na forma normal de empaquetamento do compoñente principal, pero que non sexa por si mesma o
compoñente principal, e (b) sirva unicamente para permitir o uso da obra con tal compoñente principal ou
para implementar unha interface estándar para a cal exista a disposición do público unha implementación en
forma de código fonte. Un compoñente principal, neste contexto, é un compoñente fundamental (núcleo, sistema
de xanelas, etc.) do sistema operativo específico (se houber) no que funcione a obra executábel, ou un
compilador utilizado para producir a obra, ou un intérprete de código obxecto utilizado para executalo.

A fonte correspondente para unha obra en código obxecto refírese a todo o código fonte necesario para xerar,
instalar e (para unha obra executábel) executar o código obxecto e modificar a obra, incluídas as secuencias
de comandos para controlar esas actividades. Con todo, non inclúe as bibliotecas de sistema da obra, así como
tampouco ferramentas de aplicación xeral ou programas libres xeralmente dispoñíbeis que se utilicen sen
modificacións para realizar esas actividades pero que non formen parte da obra. Por exemplo, a fonte
correspondente inclúe os arquivos de definición de interface asociados aos arquivos fonte para a obra, así
como o código fonte para as bibliotecas compartidas e os subprogramas vinculados de forma dinámica requiridos
especificamente conforme ao seu deseño, por exemplo, mediante a comunicación de datos intrínseca ou o
control de fluxo entre eses subprogramas e outras partes da obra.

A fonte correspondente non necesita incluír nada que as persoas usuarias poidan rexenerar automaticamente
doutras partes da fonte correspondente.

A fonte correspondente para unha obra en código fonte é esa mesma obra.


2. Permisos básicos

Todos os dereitos que se outorgan conforme a esta licenza outórganse coa protección do copyright que ampara
o programa e son irrevogábeis cando se cumpran as condicións estabelecidas. Esta licenza autoriza en forma
expresa e ilimitada a executar o programa sen modificacións. O produto obtido a partir da execución dunha
obra amparada está cuberto por esta licenza unicamente se o produto, dado o seu contido, constitúe unha obra
amparada. Esta licenza recoñece os seus dereitos de uso razoábel e outros equivalentes, conforme as leis de
copyright.

Vostede pode crear, executar e propagar obras amparadas que non transmita, sen condicións na medida en que a
súa licenza siga vixente dalgunha outra maneira. Vostede pode transmitir obras amparadas a terceiras persoas
co único fin de que estes realicen modificacións exclusivamente para vostede, ou que lle proporcionen os
medios para executar esas obras, con tal de que vostede cumpra cos termos desta licenza no que respecta á
transmisión de calquera material que exceda o seu control do copyright. Quen desta maneira creen ou executen
as obras amparadas para vostede deben facelo exclusivamente no seu nome, baixo a súa dirección e control e
sobre a base de termos que lles prohiban facer copias do seu material protexido por dereitos de autoría fóra
da relación que manteñen con vostede.

A transmisión baixo calquera outra circunstancia permítese unicamente conforme ás condicións que se describen
a continuación. Prohíbese sublicenciar; a sección 10 fai que sexa innecesario.

3. Protección dos dereitos legais das persoas usuarias fronte á Lei antievasión

Ningunha obra amparada se considerará parte dunha medida tecnolóxica efectiva conforme a calquera lei
aplicábel que cumpra as obrigas do artigo 11 do tratado de copyright OMPI (Organización Mundial da Propiedade
Intelectual, WIPO polas súas siglas en inglés) adoptado o 20 de decembro de 1996 ou a leis similares que
prohiban ou restrinxan a evasión de devanditas medidas.

Cando vostede transmite unha obra amparada, renuncia a calquera facultade legal de prohibir a evasión de
medidas tecnolóxicas na medida en que a evasión se realice ao facer uso dos dereitos que se outorgan conforme
a esta licenza con respecto á obra amparada, e nega calquera intención de restrinxir o uso ou a modificación
da obra como unha forma de facer valer, en contra das persoas usuarias da obra, os seus dereitos legais ou
os dereitos legais de terceiras partes para prohibir a evasión de medidas tecnolóxicas.


4. Transmisión de copias literais

Vostede pode transmitir copias literais do código fonte do programa tal cal o reciba, por calquera medio,
coa condición de que publique dun modo visíbel e adecuado un aviso de copyright apropiado en cada copia;
manteña intactos todos os avisos que estabelecen que esta licenza e calquera termo non-permisivo que se
agregue conforme á sección 7 se lle aplican ao código; manteña intactos todos os avisos mediante os cales
se nega calquera tipo de garantía; e lles proporcione a todas as persoas destinatarias unha copia desta
licenza xunto co programa.

Vostede pode cobrar o prezo que vostede desexe ou non cobrar nada por cada copia que transmita, e pode
ofrecer mantemento ou protección de garantía a cambio dunha tarifa.


5. Transmisión de versións modificadas do código fonte

Vostede pode transmitir unha obra baseada no programa, ou as modificacións para producilo a partir do
programa, en forma de código fonte conforme os termos da sección 4, coa condición de que tamén cumpra con
todas as condicións que se inclúen a continuación:

    * a) A obra debe conservar avisos visíbeis que estabelezan que a modificou e que inclúa a data
 correspondente.
    * b) A obra debe conservar avisos visíbeis que estabelezan que se realiza conforme a esta licenza e a
 todas as condicións que se agreguen baixo a sección 7. Este requirimento modifica o requirimento da sección
 4 que estabelece que se deben manter intactos todos os avisos.
    * c) Debe outorgar unha licenza pola obra completa, en forma íntegra, conforme a esta licenza, a
 calquera terceira persoa que adquira unha copia. Por tanto, esta licenza, xunto con calquera termo adicional
 aplicábel da sección 7, aplícaselle á obra na súa totalidade e a todas as súas partes, independentemente do
 modo en que se empaqueten. Esta licenza non autoriza para outorgar licenzas para a obra de ningún outro modo,
 pero non invalida esa autorización se vostede a recibiu por separado.
    * d) Se a obra tivese interfaces de usuario ou usuaria interactivas, cada unha delas deberá mostrar os
 avisos legais apropiados. No entanto, se o programa tivese interfaces interactivas que non mostraren avisos
 legais apropiados, non necesita incluílos.

Denomínase conxunto á compilación dunha obra cuberta con outras obras diferentes e independentes que pola súa
natureza non sexan extensións da obra cuberta nin se combinen con ela para formar un programa máis grande nun
volume dun medio de distribución ou almacenamento, se a compilación e o copyright consecuente non se utilizan
para restrinxir o acceso ou os dereitos legais das persoas usuarias da compilación alén do que permitan as obras
individuais. A inclusión dunha obra incluída nun conxunto non implica que esta licenza se lle aplique ás outras
partes do conxunto.


6. Transmisión de códigos que non son códigos fonte

Vostede pode transmitir unha obra cuberta en código obxecto conforme os termos das seccións 4 e 5, a
condición de que tamén transmita a fonte correspondente lexíbel por máquina conforme os termos desta licenza,
dalgunha das seguintes maneiras:

    * a) Transmisión do código obxecto dentro dun produto físico (incluídos medios físicos de distribución)
 ou incorporado a este, acompañado da fonte correspondente nun medio físico duradeiro habitual para o
 intercambio de software.
    * b) Transmisión do código obxecto dentro dun produto físico (incluídos medios físicos de distribución)
 ou incorporado a este, acompañado dunha oferta escrita, que sexa válida por un prazo mínimo de tres anos e
 polo tempo que vostede ofreza repostos ou servizo técnico para ese modelo do produto, para proporcionarlle
 a calquera persoa que posúa o código obxecto (1) unha copia da fonte correspondente para todo o software do
 produto que estea cuberto por esta licenza, nun medio físico duradeiro habitual para o intercambio de
 software, a cambio dun prezo que non exceda o custo razoábel da acción física de transmitir esta fonte, ou
 (2) acceso á copia da fonte correspondente desde un servidor de rede sen custo ningún.
    * c) Transmisión de copias individuais do código obxecto xunto cunha copia da oferta escrita para
 proporcionar a fonte correspondente. Esta opción permítese unicamente en ocasións e para fins non comerciais,
 e só na medida en que vostede reciba o código obxecto cunha oferta desta natureza, conforme á subsección 6b.
    * d) Transmisión do código obxecto ofrecendo acceso desde un lugar determinado (en forma gratuíta ou
 onerosa) e ofrecendo un acceso equivalente á fonte correspondente do mesmo xeito e desde o mesmo lugar sen
 custo adicional. Non é necesario que lles esixa ás persoas destinatarias que copien a fonte correspondente
 xunto co código obxecto. Se o lugar ofrecido para copiar o código obxecto fose un servidor de rede, a fonte
correspondente poderá estar nun servidor diferente (operado por vostede ou por unha terceira persoa) que ofreza
posibilidades de reprodución equivalentes, coa condición de que se inclúan, xunto co código obxecto, instrucións
claras para atopar a fonte correspondente. Independentemente de qué servidor aloxa a fonte correspondente, vostede
mantén a obriga de se asegurar de que estea dispoñíbel polo tempo que sexa necesario para satisfacer estes
requirimentos.
    * e) Transmisión do código obxecto mediante transferencia entre persoas usuarias (peer to peer), coa
 condición de que se lles informe da situación do código obxecto e a fonte correspondente da obra para o
 público en xeral sen custo ningún conforme á subsección 6d.

Non se precisa incluír unha parte separábel do código obxecto, de código fonte excluído da fonte
correspondente como unha biblioteca de sistemas, para transmitir o código obxecto da obra.

Por produto de persoa usuaria enténdese (1) un produto de consumo, que é calquera ben persoal tanxíbel que
se utilice habitualmente para fins persoais, familiares ou domésticos, ou (2) calquera cousa que se deseñe
ou comercialice para a súa incorporación nunha vivenda. Ao determinar se un produto é un produto de consumo,
os casos dubidosos deberán resolverse a prol da cobertura. Para un produto específico que recibe unha persoa
usuaria particular, un uso habitual é o uso común ou típico que se lle adoita dar a ese tipo de produto,
independentemente da condición da persoa usuaria particular ou da forma en que a persoa usuaria particular
utilice o produto ou das expectativas propias ou doutras persoas respecto do uso do produto. Un produto
considérase un produto de consumo independentemente de que que se lle poida dar usos substanciais de índole
comercial, industrial ou alleos ao consumo, non sendo que eses usos representen o único modo significativo de
utilizar o produto.

Por información de instalación dun produto de usuario ou usuaria enténdese calquera método, procedemento,
clave de autorización ou outro tipo de información requirida para instalar e executar versións modificadas
dunha obra cuberta en tal produto de usuario ou usuaria a partir dunha versión modificada da súa fonte
correspondente. A información debe ser suficiente para garantir que o funcionamento continuo do código
obxecto modificado non se vexa afectado ou imposibilitado só polo feito de se ter realizado a modificación.

No caso de que vostede transmita o código obxecto dunha obra conforme a esta sección nun produto de usuario
ou usuaria, xunto co produto da persoa usuaria ou especificamente para o seu uso nun produto de usuario ou
usuaria, e a transmisión se produza como parte dunha transacción mediante a cal os dereitos de posesión e
uso deste produto de persoa usuaria se lle transfiran á persoa destinataria por un prazo limitado ou
ilimitado independentemente das particularidades da transacción), a fonte correspondente transmitida conforme
a esta sección deberá ir acompañada da información de instalación. Con todo, este requirimento non se lle
aplicará no caso de que nin vostede nin unha terceira persoa conserven a capacidade para instalar o código
obxecto modificado no produto de usuario ou usuaria (por exemplo, que a obra se instalase en memoria ROM).

O requirimento de proporcionar información de instalación non implica a necesidade de seguir provendo
servizo técnico, garantías ou actualizacións para unha obra que sexa modificada ou instalada pola persoa
destinataria ou para o produto de persoa usuaria no cal a modificou ou instalou. Poderá negarse o acceso a
unha rede cando a modificación en si mesma poida afectar dun modo adverso e substancial o funcionamento da
rede ou infrinxa as normas e os protocolos de comunicación a través da rede.

A fonte correspondente que se transmita e a información de instalación que se proporcione conforme a esta
sección deberán presentarse nun formato sobre o cal exista documentación pública (e cunha implementación
dispoñíbel para o público en código fonte) e non deberán requirir ningunha clave ou contrasinal especial
para o seu desempaquetado, lectura ou reprodución.


7. Termos adicionais

Os permisos adicionais son termos que complementan os termos desta licenza ao permitir excepcións a unha ou
máis condicións. Os permisos adicionais que se lle aplican ao programa na súa totalidade deberán tratarse
coma se formasen parte desta licenza, na medida en que sexan válidos conforme as leis aplicábeis. No caso de
que os permisos adicionais se apliquen unicamente a unha parte do programa, esta parte poderá utilizarse por
separado conforme a eses permisos, pero o programa na súa totalidade seguirá rexéndose de acordo con esta
licenza independentemente dos permisos adicionais.

Cando vostede transmita unha copia dunha obra cuberta, poderá optar por eliminar calquera permiso adicional
da copia ou de calquera parte dela (en certos casos, cando vostede modifique a obra, poderán estabelecerse
permisos adicionais para requirir a súa eliminación). Ten autorización para incluír permisos adicionais nun
material que vostede agregue a unha obra cuberta e sobre o cal vostede posúa ou poida outorgar permisos de
copyright apropiados.

Independentemente de calquera outra disposición desta licenza, respecto do material que vostede agregue a
unha obra cuberta, vostede poderá (na medida en que o autoricen as persoas titulares dos dereitos de
copyright do dito material) complementar os termos desta licenza cos seguintes termos:

    * a) Ausencia de garantías ou limitación da responsabilidade alén dos termos das seccións 15 e 16 desta
 licenza; ou
    * b) Obriga de conservación de atribucións de autoría ou avisos legais razoábeis específicos no dito
 material ou nos avisos legais apropiados que se mostren nas obras que o conteñan; ou
    * c) Prohibición de terxiversación da orixe do material, ou requirimento de que nas versións modificadas
 deste material se indique dun modo razoábel que son diferentes da versión orixinal; ou
    * d) Limitación do uso dos nomes das persoas licenciadoras ou autoras do material para fins publicitarios;
 ou
    * e) Negativa respecto do outorgamento de dereitos conforme as leis de marcas para o uso de certos nomes
 comerciais, marcas de produtos ou marcas de servizos; ou
    * f) Requirimento de indemnización das persoas licenciadoras ou autoras do material por parte de calquera
 persoa que transmita o material (ou versións del modificadas) baixo presuncións contractuais de
 responsabilidade das e dos destinatarios por calquera responsabilidade que esas presuncións contractuais
 impoñan directamente sobre as e os licenciadores e sobre os autores ou autoras do material.

Calquera outro termo adicional non permisivo considerarase unha restrición adicional no contexto da sección
10. No caso de que o programa, tal cal vostede o recibiu, ou calquera parte del conteña un aviso que indique
que se rexe segundo esta licenza xunto cun termo que constitúa unha restrición adicional, poderá eliminar o
termo. No caso de que un documento de licenza conteña unha restrición adicional pero permita a extensión da
licenza ou a transmisión do programa conforme a esta licenza, vostede poderalle agregar á obra cuberta calquera
material conforme os termos dese documento de licenza, coa condición de que a restrición adicional non se manteña
tras a extensión da licenza ou a transmisión do programa.

No caso de que vostede agregue termos a unha obra cuberta conforme a esta sección, deberá incluír nos
arquivos fonte correspondentes unha declaración dos termos adicionais que se lle aplican aos arquivos ou un
aviso que indique a localización dos termos aplicábeis.

Poderanse estabelecer termos adicionais, sexan estes permisivos ou non permisivos, nunha licenza escrita
independente, ou a modo de excepcións; sexa como for, aplicaranse os requirimentos mencionados anteriormente.


8. Anulación

Vostede non está autorizado para propagar ou modificar unha obra cuberta de ningún outro modo que non se
estipule nesta licenza. Calquera intento non autorizado por propagala ou modificala considerarase nulo e
levará a anulación automática dos dereitos que lle outorgou esta licenza (incluída calquera licenza de
patente outorgada conforme o parágrafo terceiro da sección 11).

No entanto, no caso de que deixe de violar as cláusulas desta licenza, unha persoa titular de dereitos de
copyright particular poderá restituírlle a licenza (a) de forma provisoria, até tanto tal titular dea por
finalizada a súa licenza de forma expresa e definitiva, e (b) de forma permanente, se esa persoa  titular
non notifica a infracción por algún medio razoábel antes dos 60 días posteriores á anulación.

Así tamén, a licenza que lle outorgue unha persoa titular de dereitos de copyright particular restituiráselle
de forma permanente se a persoa titular lle notificar a infracción por algún medio razoábel, esta for a
primeira vez que vostede recibise unha notificación de violación desta licenza (por calquera obra) emitida
por esa persoa titular, e vostede emendase a infracción nun prazo de 30 días a partir da recepción da
notificación.

A extinción dos seus dereitos conforme a esta sección non anula as licenzas daquelas terceiras persoas ás
que vostede lles outorgou copias ou dereitos conforme esta licenza. No caso de que os seus dereitos se
anulen e non se lle restitúan de forma permanente, vostede non estará capacitado para recibir novas licenzas
para o mesmo material conforme á sección 10.


9. Aceptación innecesaria para a posesión de copias

Vostede non ten a obriga de aceptar esta licenza para poder recibir ou executar unha copia do programa.
De modo similar, a propagación secundaria dunha obra amparada que se produza unicamente como consecuencia
dunha transferencia entre persoas usuarias (peer to peer) co fin de recibir unha copia tampouco require
aceptación. No entanto, esta licenza é o único que o autoriza a propagar ou modificar calquera obra cuberta.
No caso de que vostede non acepte esta licenza, os actos anteriores representarán unha violación das leis de
copyright. Por tanto, ao modificar ou propagar unha obra cuberta, vostede expresa a súa aceptación desta
licenza para facelo.


10. Traspaso automático de licenza a destinatarios ou destinatarias subseguintes

Cada vez que vostede transmite unha obra cuberta, o destinatario ou destinataria recibe automaticamente das
persoas licenciadoras orixinais unha licenza para executar, modificar e propagar a obra conforme esta licenza.
Vostede non é responsábel de asegurar o cumprimento desta licenza por parte de terceiras persoas.

Unha transacción entre entidades é unha transacción mediante a cal se lle transfire o control dunha
organización ou de todo o patrimonio dunha organización, se subdivide unha organización ou se fusionan dúas
ou máis organizacións. No caso de que a propagación dunha obra cuberta se deba a unha transacción entre
entidades, cada parte da transacción que reciba unha copia da obra tamén recibirá todas as licenzas para a
obra que o predecesor ou predecesora da parte tiver ou puider outorgar conforme o parágrafo anterior, máis o
dereito de recibir do seu predecesor ou predecesora a fonte correspondente da obra, se o predecesor ou
predecesora a ten no seu poder ou pode obtela con esforzos razoábeis.

Vostede non pode impor restricións adicionais para o exercicio dos dereitos que se outorgan ou consolidan
conforme esta licenza. Por exemplo, vostede non pode impor tarifas, dereitos de autoría ou outros cargos a
cambio do exercicio dos dereitos que se outorgan conforme esta licenza, así como tampouco pode iniciar
accións legais (incluídas demandas e contestacións a demandas nun proceso legal) sobre a base dunha
infracción de patentes por crear, usar, comercializar, ofrecer para a venda ou importar o programa ou
calquera parte del.

11. Patentes

Un colaborador ou colaboradora é unha persoa ou entidade titular de dereitos de copyright que autoriza o uso
conforme esta licenza do programa ou dunha obra sobre a cal se basee o programa. A obra con licenza outorgada
desta maneira denomínase versión en colaboración do colaborador ou colaboradora.

Os dereitos de patente fundamentais dun colaborador ou colaboradora son todos os dereitos de patente baixo a
titularidade ou o control da persoa colaboradora, xa sexa porque os adquiriu tras o outorgamento desta licenza
ou a partir dela, que poidan infrinxirse dalgún modo permitido por esta licenza para crear, usar ou vender a súa
versión en colaboración, pero non inclúen dereitos que se poderían infrinxir unicamente como consecuencia de
modificacións posteriores á versión en colaboración. Para os efectos desta definición, o control inclúe o dereito
de outorgar sublicenzas de patente dun modo consonte cos requirimentos desta licenza.

Cada colaborador ou colaboradora outórgalle a vostede unha licenza de patente internacional non exclusiva
libre de dereitos de autoría conforme os dereitos de patente fundamentais da ou do colaborador para crear,
usar, comercializar, ofrecer á venda, importar e executar, modificar e propagar dalgún outro modo o contido da
súa versión en colaboración.

Nos tres parágrafos que se inclúen a continuación, unha licenza de patente é calquera contrato ou acordo
expreso, independentemente da súa denominación, mediante o cal se conveña non exercer dereitos de patente
(como, por exemplo, unha autorización expresa para facer uso dunha patente ou unha cláusula que estabeleza
que non se iniciarán accións legais por infrinxir os dereitos de patente). Por outorgar unha licenza de
patente desta natureza a outra parte enténdese o acto de celebrar un contrato ou acordo mediante o cal se
convén non exercer dereitos de patente en contra da dita parte.

No caso de que vostede transmita unha obra amparada, sabendo que está suxeita a unha licenza de patente, e a
fonte correspondente da obra non estiver dispoñíbel para a súa reprodución, en forma gratuíta e conforme os
termos desta licenza, a través dun servidor de rede de acceso público ou outro medio igualmente accesíbel,
vostede deberá (1) poñer a fonte correspondente a disposición do destinatario ou destinataria subseguinte,
(2) renunciar ao beneficio da licenza de patente para esta obra en particular, ou ben (3) tomar as medidas
necesarias para estender a licenza de patente aos destinatarios e destinatarias subseguintes dun modo acorde
cos requirimentos desta licenza. A frase sabendo que está suxeita a unha licenza de patente significa que
vostede efectivamente sabe que, de non ser pola licenza de patente, a transmisión da obra cuberta nun país
ou o uso que puider darlle   as persoas destinatarias á obra amparada nun país infrinxirían unha ou máis
patentes identificábeis no dito país que vostede considera válidas por diversas razóns.

No caso de que, en relación cunha transacción ou contrato individual, vostede transmitise unha obra amparada
ou a difundise conseguindo a súa transmisión e outorgase a algunhas das partes que reciban a obra amparada
unha licenza de patente que as autorizase a usar, difundir, modificar ou transmitir unha copia específica da
obra cuberta, a licenza de patente que vostede outorgue estenderase automaticamente a todos os destinatarios
e destinatarias da obra cuberta e ás obras que se baseen nela.

Unha licenza de patente considérase discriminatoria cando non inclúe dentro do seu ámbito de amparo un ou máis
dos dereitos que se outorgan especificamente conforme a esta licenza, prohibe o uso de devanditos dereitos ou
se outorga como condición de que non se usen os ditos dereitos. Vostede non debe transmitir unha obra cuberta
se fose unha das partes dun acordo con outra entidade ou persoa que se dedicase á distribución de software,
conforme ao cal vostede debese pagarlle á outra entidade ou persoa pola actividade que vostede realice con
respecto á transmisión da obra e esa entidade ou persoa outorgase a calquera das partes que reciban de vostede
a obra cuberta unha licenza de patente discriminatoria (a) en relación coas copias da obra cuberta
transmitidas por vostede (ou as copias que se fagan desas copias), ou (b) principalmente para compilacións
ou produtos específicos que conteñan a obra cuberta e en relación con estes, a menos que vostede celebrase
o contrato ou que a patente se outorgase antes do 28 de marzo de 2007.

Ningunha disposición desta licenza deberá interpretarse como excluente ou limitativa de ningunha licenza
implícita ou outras defensas legais contra infraccións ás que, doutro xeito, vostede puidese ter dereito
conforme á lei de propiedade intelectual vixente.


12. Protección da liberdade de terceiras partes

No caso de que lle fosen impostas condicións (xa sexa por unha orde xudicial, un contrato ou dalgún outro
modo) que contradixesen as condicións desta licenza, vostede non quedará eximido de cumprir as condicións
desta licenza. No caso de que non poida transmitir unha obra cuberta dun modo que lle permita cumprir
simultaneamente coas obrigas estabelecidas por esta licenza e calquera outra obriga pertinente, non poderá
transmitila de ningún modo. Por exemplo, no caso de que vostede acepte termos que o obriguen a cobrar dereitos
de autoría por redistribución a daqueles aos que vostede transmita o programa, a única forma de satisfacer
tanto estes requirimentos como esta licenza será absterse de transmitir o programa.


13. Uso conxunto coa licenza pública xeral Affero de GNU

Independentemente de calquera outra disposición desta licenza, vostede ten permiso para vincular ou combinar
calquera obra cuberta cunha obra con licenza outorgada conforme á versión 3 da licenza pública xeral Affero
de GNU nunha única obra combinada e transmitir a obra resultante. Os termos desta licenza seguirán
aplicándoselle á parte que corresponda á obra cuberta, pero os requirimentos especiais da sección 13 da
licenza pública xeral Affero de GNU sobre a interacción a través dunha rede aplicaránselle á combinación como
tal.


14. Revisións desta licenza

A Fundación para o Software Libre poderá publicar revisións e/ou versións novas da licenza pública xeral de
GNU de cando en vez. Tales versións serán de natureza semellante á versión actual, pero poderán diferir canto
aos detalles para afrontar novos problemas ou coidados.

Cada versión recibirá un número de versión que a distinga. No caso de que o programa especifique que se rexe
por unha versión determinada da licenza pública xeral de GNU ou calquera versión posterior, vostede poderá
optar por adoptar os termos e condicións desta versión específica ou de calquera versión posterior que
publique a Fundación para o Software Libre. No caso de que o Programa non especifique un número de versión da
licenza pública xeral de GNU, vostede poderá rexerse por calquera versión que publique a Fundación para o
Software Libre.

Se o programa especifica que un apoderado ou apoderada pode decidir que versións da licenza pública xeral de
GNU poden aplicarse no futuro, a declaración pública do apoderado ou apoderada sobre a aceptación dunha
versión determinada autorizarao a vostede, de forma permanente, a optar por tal versión para o programa.

Poida que as versións posteriores da licenza se lle outorguen permisos adicionais ou diferentes. No entanto,
non se lles imporán obrigas adicionais a ningunha persoa autora ou titular de dereitos de copyright como
resultado da adopción da versión posterior que vostede elixa.

15. Carencia de garantías

O PROGRAMA OFRÉCESE SEN NINGÚN TIPO DE GARANTÍAS, NA MEDIDA EN QUE O PERMITAN AS LEIS APLICÁBEIS. SALVANTE
DISPOSICIÓN CONTRARIA POR ESCRITO, OS OU AS TITULARES DE DEREITOS DE AUTORÍA E/OU OUTRAS PARTES PROVÉN O
PROGRAMA "TAL CAL" SEN GARANTÍAS DE NINGÚN TIPO, XA SEXAN EXPRESAS OU IMPLÍCITAS, INCLUÍDAS, AÍNDA QUE NON
DE FORMA TAXATIVA, AS GARANTÍAS IMPLÍCITAS DE VALOR COMERCIAL E APTITUDE PARA UN PROPÓSITO DETERMINADO.
VOSTEDE ASUME TODOS OS RISCOS CON RESPECTO Á CALIDADE E O DESEMPEÑO DO PROGRAMA. NO CASO DE QUE O PROGRAMA
TIVESE DEFECTOS, VOSTEDE ASUME O CUSTO DE TODAS AS ACTIVIDADES DE MANTEMENTO, REPARACIÓN OU CORRECCIÓN.

16. Limitación da responsabilidade

EN NINGÚN CASO, SALVO QUE ASÍ O DISPOÑAN AS LEIS APLICABLES OU UN CONTRATO POR ESCRITO, UNHA PERSOA TITULAR
DE DEREITOS DE AUTORÍA OU UNHA TERCEIRA PARTE QUE MODIFIQUE E/OU TRANSMITA O PROGRAMA SEGUNDO SE AUTORIZA
ANTERIORMENTE SERÁ RESPONSÁBEL PERANTE VOSTEDE DE CALQUERA DANO, INCLUÍDOS OS DANOS XERAIS, ESPECIAIS,
FORTUÍTOS OU DERIVADOS, QUE POIDAN XURDIR DO USO OU A INCAPACIDADE DE USO DO PROGRAMA (INCLUÍDOS, AÍNDA QUE
NON EXCLUSIVAMENTE, A PERDA DE INFORMACIÓN, A SUBMINISTRACIÓN DE INFORMACIÓN IMPRECISA OU AS PERDAS QUE POIDAN
SUFRIR VOSTEDE OU TERCEIRAS PARTES OU A INCAPACIDADE DO PROGRAMA PARA INTERACTUAR CON OUTROS PROGRAMAS),
AÍNDA CANDO ESTE OU ESTA TITULAR OU TERCEIRA PARTE FOSE ADVERTIDA DA POSIBILIDADE DE TALES DANOS.


17. Interpretación das seccións 15 e 16

No caso de que as cláusulas de ausencia de garantías e limitación da responsabilidade anteriores carecesen de
validez legal a nivel local conforme os seus termos, os xulgados deberán aplicar as leis locais que máis se
asimilen a unha exención absoluta de calquera responsabilidade civil en relación co programa, salvo que unha
copia do programa estea acompañada dunha garantía ou presunción de responsabilidade a cambio dunha tarifa.

FIN DE TERMOS E CONDICIÓNS

Como aplicar estes termos aos seus programas novos

Se vostede desenvolve un programa novo e desexa que o público lle atope a maior utilidade posíbel, a mellor
maneira de logralo é facer deste un software libre para que todos o poidan redistribuír e modificar conforme
a estes termos.

Para facelo, achegue os seguintes avisos ao programa. O máis seguro é engadilos ao comezo de cada arquivo
fonte co fin de que se estabeleza dun modo efectivo a exclusión de garantías. Así mesmo, cada arquivo debería
incluír a liña do copyright e unha ligazón á localización do aviso completo.


Copyright ©

Este programa é software libre: vostede pode redistribuílo e/ou modificalo conforme os termos da licenza
pública xeral de GNU publicada pola Fundación para o Software Libre, xa sexa a versión 3 desta licenza ou
(á súa elección) calquera versión posterior.

Este programa distribúese co desexo de que lle resulte útil, pero SEN GARANTÍAS DE NINGÚN TIPO; nin sequera
coas garantías implícitas de VALOR COMERCIAL OU APTITUDE PARA UN PROPÓSITO DETERMINADO. Para máis información,
consulte a licenza pública xeral de GNU.

Xunto con este programa, debérase incluír unha copia da licenza pública xeral de GNU.

De non ser así, vexa en <http://www.gnu.org/licenses/>.

Inclúa tamén información de contacto que lles permita ás persoas destinatarias comunicarse con vostede, xa
sexa por correo electrónico ou convencional.

Se o programa admite a interacción entre terminais, asegúrese de que mostre un breve aviso como o que se
inclúe a continuación cando se inicie en modo interactivo:

Copyright ©

Este programa proporciónase SEN GARANTÍAS DE NINGÚN TIPO; para máis información escriba 'show w'.

Este programa é software libre e vostede pode redistribuílo consonte certas condicións; para máis información,
escriba 'show c'.


Os comandos hipotéticos 'show w' e 'show c' deberían mostrar as partes correspondentes da licenza pública
xeral. De máis está dicir que os comandos do seu programa poden ser diferentes; para unha interface gráfica
de persoa usuaria, debería utilizar un cadro de diálogo do tipo Acerca de.

No caso de que traballe como programador ou programadora para unha entidade empregadora ou estabelecemento
educativo, asegúrese tamén de que asinen unha renuncia de copyright para o programa, se fose necesario. Para
máis información verbo deste respecto e sobre como aplicar e cumprir a GNU GPL, vexa en
<http://www.gnu.org/licenses/>.

A licenza pública xeral de GNU non autoriza a inclusión do seu programa en programas de propiedade privada.
Se o seu programa fose unha biblioteca de subrutinas, poida que considere máis útil permitir a vinculación de
aplicacións de propiedade privada coa biblioteca. Se vostede desexar facer isto, utilice a licenza pública
xeral reducida de GNU en lugar desta licenza. Pero primeiro, por favor, lea a información que se inclúe en
<http://www.gnu.org/philosophy/why-not-lgpl.html>.

